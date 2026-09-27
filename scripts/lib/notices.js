'use strict';
// Очередь отложенных сообщений агенту (план §2): PostCompact и Инспектор кладут,
// UserPromptSubmit / PreToolUse отдают через additionalContext и помечают доставленными.
// Файл append-only: доставка = строка {id, kind:"delivered"}.

const fs = require('fs');
const path = require('path');
const { layout, ensureDir, FILE_MODE } = require('./paths');
const { nowIso } = require('./ledger');

function readRows(cwd) {
  try {
    const text = fs.readFileSync(layout(cwd).notices, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function push(cwd, notice) {
  const file = layout(cwd).notices;
  ensureDir(path.dirname(file));
  const row = Object.assign(
    { id: 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7), ts: nowIso() },
    notice
  );
  fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: FILE_MODE });
  return row;
}

function pending(cwd, sessionId) {
  const rows = readRows(cwd);
  const delivered = new Set(rows.filter((r) => r.kind === 'delivered').map((r) => r.id));
  return rows.filter(
    (r) => r.kind !== 'delivered' && !delivered.has(r.id) && (!sessionId || !r.session_id || r.session_id === sessionId)
  );
}

function markDelivered(cwd, ids) {
  const file = layout(cwd).notices;
  ensureDir(path.dirname(file));
  const lines = (ids || []).map((id) => JSON.stringify({ id, kind: 'delivered', ts: nowIso() }));
  if (lines.length) fs.appendFileSync(file, lines.join('\n') + '\n', { mode: FILE_MODE });
  return lines.length;
}

// Забрать очередь и сразу пометить доставленной. Возвращает текст или ''.
//
// Захват через переименование файла (LOW-1 отчёта security-v1): pending() читал, а
// markDelivered() дописывал, и два одновременных UserPromptSubmit доставляли одно и то же
// уведомление дважды. renameSync атомарен: файл достаётся ровно одному процессу.
// Захваченный файл возвращается на место вместе с отметками о доставке — очередь
// append-only, поэтому дописанное за время захвата не теряется.
function drain(cwd, sessionId) {
  const file = layout(cwd).notices;
  const claim = file + '.claim-' + process.pid + '-' + Date.now().toString(36);

  let claimed = false;
  try {
    fs.renameSync(file, claim);
    claimed = true;
  } catch (_) {
    // Файла нет или его уже захватил другой процесс — нам доставлять нечего.
    return { text: '', ids: [] };
  }

  try {
    const rows = readRowsOf(claim);
    const delivered = new Set(rows.filter((r) => r.kind === 'delivered').map((r) => r.id));
    const fresh = rows.filter(
      (r) => r.kind !== 'delivered' && !delivered.has(r.id) &&
        (!sessionId || !r.session_id || r.session_id === sessionId)
    );
    const ids = fresh.map((r) => r.id);
    // Отметки о доставке дописываются в захваченный файл, пока он вне общего пути.
    if (ids.length) {
      const lines = ids.map((id) => JSON.stringify({ id, kind: 'delivered', ts: nowIso() }));
      fs.appendFileSync(claim, lines.join('\n') + '\n', { mode: FILE_MODE });
    }
    const text = fresh.map((r) => r.text).filter(Boolean).join('\n');
    return { text, ids };
  } finally {
    // Возврат на место. Если за время захвата кто-то создал новый файл очереди, его
    // строки дописываются к нашему: append-only, ничего не теряется.
    if (claimed) {
      try {
        let tail = '';
        try { tail = fs.readFileSync(file, 'utf8'); } catch (_) { tail = ''; }
        if (tail) fs.appendFileSync(claim, tail.endsWith('\n') ? tail : tail + '\n', { mode: FILE_MODE });
        fs.renameSync(claim, file);
      } catch (_) { /* очередь не критична: хук обязан выйти с нулём */ }
    }
  }
}

function readRowsOf(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = { push, pending, markDelivered, drain, readRows };
