'use strict';
// Очередь отложенных сообщений агенту (план §2): PostCompact и Инспектор кладут,
// UserPromptSubmit / PreToolUse отдают через additionalContext и помечают доставленными.
// Файл append-only: доставка = строка {id, kind:"delivered"}.

const fs = require('fs');
const path = require('path');
const { layout, ensureDir } = require('./paths');
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
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
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
  if (lines.length) fs.appendFileSync(file, lines.join('\n') + '\n');
  return lines.length;
}

// Забрать очередь и сразу пометить доставленной. Возвращает текст или ''.
function drain(cwd, sessionId) {
  const rows = pending(cwd, sessionId);
  if (!rows.length) return { text: '', ids: [] };
  const ids = rows.map((r) => r.id);
  markDelivered(cwd, ids);
  const text = rows.map((r) => r.text).filter(Boolean).join('\n');
  return { text, ids };
}

module.exports = { push, pending, markDelivered, drain, readRows };
