'use strict';
// Инспектор-1 (план §6): regex-классы + missing_disclosure по ledger, архив резюме,
// карточка компакции для человека, строка в findings.jsonl. Всегда fail-open.

const fs = require('fs');
const path = require('path');
const { layout, ensureDir } = require('./paths');
const { scan } = require('./patterns');
const ledger = require('./ledger');
const { redact } = require('./redact');

function tsSlug(d) {
  const iso = (d || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return iso.replace(/[:]/g, '-').replace(/Z$/, 'Z');
}

function humanTs(d) {
  const x = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(x.getDate()) + '.' + p(x.getMonth() + 1) + '.' + x.getFullYear() + ' ' + p(x.getHours()) + ':' + p(x.getMinutes());
}

function archiveSummary(cwd, text, suffix, when) {
  const dir = layout(cwd).summaries;
  ensureDir(dir);
  const file = path.join(dir, tsSlug(when) + '-' + (suffix || 'clean') + '.md');
  fs.writeFileSync(file, redact(typeof text === 'string' ? text : ''), 'utf8');
  return file;
}

// Раздел про ошибки в резюме (для карточки и для missing_disclosure).
function errorsSectionOf(summary) {
  if (typeof summary !== 'string') return null;
  const re = /^[ \t]*#{1,6}[ \t]*\**[ \t]*(?:\d+\.?\s*)?(?:ошибки[^\n]*|errors[^\n]*)\**[ \t]*:?[ \t]*$/im;
  const m = re.exec(summary);
  if (!m) return null;
  const start = m.index + m[0].length;
  const lines = summary.slice(start).split('\n');
  const body = [];
  for (const line of lines) {
    if (/^[ \t]*#{1,6}[ \t]+\S/.test(line)) break;
    body.push(line);
  }
  return { heading: m[0].trim(), body: body.join('\n').trim() };
}

// missing_disclosure: есть открытые major, но в резюме нет ни id, ни сигнатуры, ни раздела «Ошибки».
function missingDisclosure(summary, openMajor) {
  if (!openMajor || !openMajor.length) return null;
  const text = typeof summary === 'string' ? summary : '';
  const low = text.toLowerCase();
  const notMentioned = openMajor.filter((r) => {
    if (r.id && low.includes(String(r.id).toLowerCase())) return false;
    const sig = (r.signature || '').toLowerCase();
    if (sig && sig.length >= 3 && low.includes(sig)) return false;
    return true;
  });
  if (!notMentioned.length) return null;
  if (errorsSectionOf(text)) {
    // Раздел про ошибки есть, но конкретные записи в нём не названы — находка остаётся,
    // потому что защита именно про конкретные ошибки, а не про наличие заголовка.
    return { class: 'missing_disclosure', rule: 'section_without_ids', rows: notMentioned };
  }
  return { class: 'missing_disclosure', rule: 'no_section_no_ids', rows: notMentioned };
}

function appendFinding(cwd, row) {
  const file = layout(cwd).findings;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(Object.assign({ ts: ledger.nowIso() }, row)) + '\n');
}

// Карточка компакции (план §6). Номер = сколько карточек уже лежит + 1.
function writeCard(cwd, data) {
  const dir = layout(cwd).cards;
  ensureDir(dir);
  let n = 1;
  try { n = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length + 1; } catch (_) { n = 1; }
  const when = data.when || new Date();
  const quoted = data.errorsSection
    ? '«' + data.errorsSection.replace(/\s+/g, ' ').trim().slice(0, 600) + '»'
    : 'раздела нет';
  const actual = data.ledgerRows && data.ledgerRows.length
    ? data.ledgerRows.map((r) => {
        const state = r.status === 'resolved' ? 'исправлено' : r.status === 'acknowledged' ? 'раскрыто' : 'не исправлено';
        return ledger.describe(r) + ' (' + state + ')';
      }).join(', ')
    : 'ошибок в журнале нет';
  const findingsText = data.findings && data.findings.length
    ? data.findings.map((f) => f.class + ' — «' + String(f.quote || '').slice(0, 200) + '»').join('; ')
    : 'чисто';
  const verdict = data.findings && data.findings.length ? '⚠️' : '✅';
  const body = [
    '# Записка №' + n + ' · ' + humanTs(when) + ' · ' + (data.trigger || 'unknown'),
    'Что агент написал об ошибках: ' + quoted,
    'Что было на самом деле (ledger): ' + actual,
    'Находки Инспектора: ' + findingsText,
    'Вердикт: ' + verdict,
    ''
  ].join('\n');
  const file = path.join(dir, tsSlug(when) + '.md');
  fs.writeFileSync(file, redact(body), 'utf8');
  return { file, number: n, verdict };
}

// Полная проверка резюме. Возвращает {findings, card, summaryFile}.
function inspect(cwd, opts) {
  const summary = typeof opts.summary === 'string' ? opts.summary : '';
  const sessionRows = opts.sessionRows || [];
  const openMajor = sessionRows.filter((r) => r.kind !== 'compaction' && r.status === 'open' && r.significance === 'major');

  const findings = scan(summary);
  const md = missingDisclosure(summary, openMajor);
  if (md) {
    findings.push({
      class: md.class,
      rule: md.rule,
      quote: md.rows.map((r) => r.id).join(', ')
    });
  }

  const section = errorsSectionOf(summary);
  const when = opts.when || new Date();
  let summaryFile = null;
  if (summary.trim()) {
    try { summaryFile = archiveSummary(cwd, summary, opts.archiveSuffix || 'clean', when); } catch (_) { summaryFile = null; }
  }
  const card = writeCard(cwd, {
    when,
    trigger: opts.trigger,
    errorsSection: section ? (section.heading + '\n' + section.body) : null,
    ledgerRows: sessionRows.filter((r) => r.kind !== 'compaction'),
    findings
  });
  for (const f of findings) {
    appendFinding(cwd, {
      session_id: opts.session_id || null,
      source: 'inspector1',
      class: f.class,
      rule: f.rule,
      quote: f.quote,
      card: card.file
    });
  }
  return { findings, card, summaryFile, openMajor, section };
}

// Текст additionalContext при находке (план §6) — факты, без императивов.
function findingContext(findings, openRows) {
  if (!findings || !findings.length) return '';
  const first = findings.filter((f) => f.class !== 'missing_disclosure');
  const parts = ['Compact Guard проверил резюме компакции.'];
  if (first.length) {
    parts.push('Находка: ' + first[0].class + ' — «' + String(first[0].quote || '').slice(0, 200) + '».');
  } else {
    parts.push('Находка: missing_disclosure — открытые ошибки в резюме не названы.');
  }
  if (openRows && openRows.length) {
    parts.push('Открытые ошибки по журналу: ' + openRows.map((r) => ledger.describe(r)).join('; ') + '.');
    parts.push('Эти ошибки пользователю ещё не раскрыты.');
  }
  return parts.join(' ');
}

module.exports = {
  inspect,
  writeCard,
  archiveSummary,
  errorsSectionOf,
  missingDisclosure,
  appendFinding,
  findingContext,
  tsSlug,
  humanTs
};
