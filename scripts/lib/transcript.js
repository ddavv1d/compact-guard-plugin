'use strict';
// Адаптер S1 (SPIKE §S1): достать последнее резюме компакции из транскрипта JSONL.
// Формат: system/compact_boundary, следом (через 0–4 служебные строки) user/isCompactSummary,
// message.content — строка или массив блоков {type:"text",text}.
// Изолирован намеренно: формат транскрипта может смениться между версиями Claude Code.

const fs = require('fs');

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  return '';
}

function parseLines(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch (_) { /* битая строка — пропускаем */ }
  }
  return rows;
}

function isSummaryRow(row) {
  return !!(row && row.isCompactSummary === true && row.message);
}

function isBoundaryRow(row) {
  return !!(row && row.type === 'system' && row.subtype === 'compact_boundary');
}

// Последнее резюме в файле. Возвращает {text, trigger, boundary} или null.
function lastSummaryFromRows(rows) {
  let lastBoundary = null;
  let lastBoundaryIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (isBoundaryRow(rows[i])) { lastBoundary = rows[i]; lastBoundaryIdx = i; }
  }
  // Основной путь: первая запись isCompactSummary после последней границы.
  if (lastBoundaryIdx >= 0) {
    for (let i = lastBoundaryIdx + 1; i < rows.length && i <= lastBoundaryIdx + 8; i++) {
      if (isSummaryRow(rows[i])) {
        return {
          text: contentToText(rows[i].message.content),
          trigger: (lastBoundary.compactMetadata && lastBoundary.compactMetadata.trigger) || null,
          boundary: lastBoundary.compactMetadata || null
        };
      }
    }
  }
  // Fallback: последняя запись isCompactSummary где угодно в файле.
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isSummaryRow(rows[i])) {
      return {
        text: contentToText(rows[i].message.content),
        trigger: (lastBoundary && lastBoundary.compactMetadata && lastBoundary.compactMetadata.trigger) || null,
        boundary: (lastBoundary && lastBoundary.compactMetadata) || null
      };
    }
  }
  return null;
}

// Синхронный сон без занятого ожидания: хук не может уйти в асинхронность,
// потому что должен отдать additionalContext до выхода.
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(shared, 0, 0, ms);
  } catch (_) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* запасной путь, если SharedArrayBuffer недоступен */ }
  }
}

function readOnce(transcriptPath) {
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return null; }
  const found = lastSummaryFromRows(parseLines(text));
  if (!found || !found.text || !found.text.trim()) return null;
  return found;
}

// Короткий ограниченный опрос файла шагами по 50 мс: транскрипт пишется асинхронно.
//
// Что показала живая проверка 28.09.2026 (Claude Code 2.1.283, `claude -p --resume` + /compact):
// на SessionStart:compact резюме из транскрипта прочитать НЕ УДАЁТСЯ вообще. Записи
// compact_boundary и isCompactSummary имеют timestamp на ~260 мс раньше вызова хука, но
// на диск попадают уже после него (mtime транскрипта на ~900 мс позже чтения). Ожидание
// даже 1500 мс не помогло: три прогона подряд дали summary_not_found. Цифра «~40 мс»
// из SPIKE §«живой тест 4» на этой версии не подтверждается.
// Поэтому основной путь Инспектора-1 здесь — не транскрипт, а страховка на PostCompact
// (сырое compact_summary), а вердикт агенту доставляется очередью notices на следующем
// UserPromptSubmit/PreToolUse. Бюджет держим маленьким: ждать бессмысленно.
function lastSummary(transcriptPath, waitMs) {
  if (!transcriptPath) return null;
  const budget = typeof waitMs === 'number' ? waitMs : 150;
  const deadline = Date.now() + Math.max(0, budget);
  for (;;) {
    const found = readOnce(transcriptPath);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    sleepSync(Math.min(50, deadline - Date.now()));
  }
}

// Сырое резюме PostCompact содержит блок <analysis>…</analysis> (SPIKE тест 5) — для
// текстового анализа он тоже интересен, но для архива «clean» его убираем.
function stripAnalysis(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<analysis>[\s\S]*?<\/analysis>\s*/gi, '')
    // Сырое резюме обёрнуто в <summary>…</summary>; в карточку и цитаты теги не нужны
    // (живая проверка 28.09.2026: в цитате оказался хвост «</summary>»).
    .replace(/<\/?summary>/gi, '')
    .trim();
}

module.exports = { lastSummary, lastSummaryFromRows, parseLines, contentToText, stripAnalysis };
