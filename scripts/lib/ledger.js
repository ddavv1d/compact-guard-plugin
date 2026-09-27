'use strict';
// ledger.jsonl — append-only журнал ошибок (план §3).
// Изменение статуса = новая строка {id, kind:"status", status}; чтение сводит по id.

const fs = require('fs');
const path = require('path');
const { layout, ensureDir } = require('./paths');
const { redactDetail } = require('./redact');
const { signature } = require('./classify');

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readState(cwd) {
  const p = layout(cwd).state;
  try {
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (s && typeof s === 'object') return s;
  } catch (_) { /* нет файла или битый — начинаем с нуля */ }
  return { next_id: 1 };
}

function writeState(cwd, state) {
  const p = layout(cwd).state;
  ensureDir(path.dirname(p));
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function nextId(cwd) {
  const state = readState(cwd);
  const n = typeof state.next_id === 'number' && state.next_id > 0 ? state.next_id : 1;
  state.next_id = n + 1;
  writeState(cwd, state);
  return 'e_' + String(n).padStart(4, '0');
}

function append(cwd, row) {
  const file = layout(cwd).ledger;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}

function readRaw(cwd) {
  try {
    const text = fs.readFileSync(layout(cwd).ledger, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter((r) => r && typeof r === 'object');
  } catch (_) {
    return [];
  }
}

// Сводка по id: базовая запись + последующие строки статуса.
function readMerged(cwd) {
  const byId = new Map();
  const order = [];
  for (const row of readRaw(cwd)) {
    if (!row.id) continue;
    if (row.kind === 'status') {
      const base = byId.get(row.id);
      if (!base) continue;
      if (row.status) base.status = row.status;
      if (row.resolved_ts) base.resolved_ts = row.resolved_ts;
      if (row.acknowledged_ts) base.acknowledged_ts = row.acknowledged_ts;
      if (typeof row.count === 'number') base.count = row.count;
      continue;
    }
    if (byId.has(row.id)) {
      // Повторная базовая строка того же id (дедуп через count) — обновляем счётчик и время.
      const base = byId.get(row.id);
      if (typeof row.count === 'number') base.count = row.count;
      if (row.ts) base.last_ts = row.ts;
      if (row.detail) base.detail = row.detail;
      continue;
    }
    const base = Object.assign({}, row);
    byId.set(row.id, base);
    order.push(row.id);
  }
  return order.map((id) => byId.get(id));
}

function forSession(cwd, sessionId) {
  if (!sessionId) return [];
  return readMerged(cwd).filter((r) => r.session_id === sessionId);
}

// Открытые записи сессии (без отметок компакции).
function openForSession(cwd, sessionId) {
  return forSession(cwd, sessionId).filter((r) => r.kind !== 'compaction' && r.status === 'open');
}

function setStatus(cwd, id, status, extra) {
  const row = Object.assign({ id, kind: 'status', ts: nowIso(), status }, extra || {});
  if (status === 'resolved') row.resolved_ts = row.resolved_ts || row.ts;
  if (status === 'acknowledged') row.acknowledged_ts = row.acknowledged_ts || row.ts;
  return append(cwd, row);
}

// Регистрация ошибки. Дедуп: открытая запись сессии с той же сигнатурой → count++.
function recordError(cwd, opts) {
  const sessionId = opts.session_id || null;
  const sig = opts.signature != null ? opts.signature : signature(opts.command || '');
  const existing = forSession(cwd, sessionId).find(
    (r) => r.kind === opts.kind && r.status === 'open' && r.signature === sig && r.tool === opts.tool
  );
  if (existing) {
    const count = (typeof existing.count === 'number' ? existing.count : 1) + 1;
    append(cwd, {
      id: existing.id,
      kind: 'status',
      ts: nowIso(),
      status: 'open',
      count
    });
    return { id: existing.id, deduped: true, count };
  }
  const id = nextId(cwd);
  const row = {
    id,
    ts: nowIso(),
    session_id: sessionId,
    tool: opts.tool || null,
    kind: opts.kind,
    significance: opts.significance === 'major' ? 'major' : 'minor',
    signature: sig,
    command: opts.command != null ? String(opts.command).slice(0, 2000) : null,
    exit_code: typeof opts.exit_code === 'number' ? opts.exit_code : null,
    detail: redactDetail(opts.detail || ''),
    count: 1,
    status: 'open',
    resolved_ts: null,
    acknowledged_ts: null
  };
  append(cwd, row);
  return { id, deduped: false, count: 1, row };
}

function recordCompaction(cwd, opts) {
  const id = nextId(cwd);
  const row = {
    id,
    ts: nowIso(),
    session_id: opts.session_id || null,
    tool: null,
    kind: 'compaction',
    significance: 'minor',
    signature: 'compaction:' + (opts.trigger || 'unknown'),
    command: null,
    exit_code: null,
    detail: '',
    trigger: opts.trigger || 'unknown',
    count: 1,
    status: 'open',
    resolved_ts: null,
    acknowledged_ts: null
  };
  append(cwd, row);
  return row;
}

// Закрытие: успешная команда с сигнатурой открытой записи → resolved.
function resolveBySignature(cwd, sessionId, sig, tool) {
  const open = forSession(cwd, sessionId).filter(
    (r) => r.kind !== 'compaction' && r.status === 'open' && r.signature === sig && (!tool || r.tool === tool)
  );
  for (const r of open) setStatus(cwd, r.id, 'resolved');
  return open.map((r) => r.id);
}

// Короткое описание записи для текстов пользователю и агенту.
function describe(row) {
  const what = row.signature || row.command || row.kind;
  let tail;
  if (row.kind === 'nonzero_exit') tail = 'exit ' + (row.exit_code == null ? '?' : row.exit_code);
  else if (row.kind === 'tool_error') tail = 'ошибка инструмента ' + (row.tool || '');
  else if (row.kind === 'test_failure') tail = 'упавшие тесты в выводе';
  else tail = row.kind;
  return row.id + ' ' + what + ' → ' + tail.trim();
}

// Ротация (план §3): чужие сессии старше N дней и события старше N дней.
function rotate(cwd, cfg, currentSessionId) {
  const paths = layout(cwd);
  const days = (cfg && cfg.retention && cfg.retention.days) || 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const removed = { ledger: 0, summaries: 0, cards: 0 };

  // Ledger: перезапись допустима только здесь, при явной ротации.
  const merged = readMerged(cwd);
  if (merged.length) {
    const keep = merged.filter((r) => {
      if (r.session_id && r.session_id === currentSessionId) return true;
      const t = Date.parse(r.last_ts || r.ts || '');
      if (!Number.isFinite(t)) return true;
      return t >= cutoff;
    });
    if (keep.length !== merged.length) {
      removed.ledger = merged.length - keep.length;
      const tmp = paths.ledger + '.tmp';
      fs.writeFileSync(tmp, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
      fs.renameSync(tmp, paths.ledger);
    }
  }

  for (const key of ['summaries', 'cards']) {
    const dir = paths[key];
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) { fs.unlinkSync(full); removed[key]++; }
      } catch (_) { /* пропускаем */ }
    }
  }
  return removed;
}

module.exports = {
  nowIso,
  readState,
  writeState,
  nextId,
  append,
  readRaw,
  readMerged,
  forSession,
  openForSession,
  setStatus,
  recordError,
  recordCompaction,
  resolveBySignature,
  describe,
  rotate
};
