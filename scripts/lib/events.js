'use strict';
// events.jsonl — каждое срабатывание каждого хука (план §2, ТЗ §5 «наблюдаемость»).
// Пишется всегда, в том числе при внутренней ошибке обработчика.

const fs = require('fs');
const path = require('path');
const { layout, ensureDir, FILE_MODE } = require('./paths');

function appendLine(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: FILE_MODE });
}

function record(cwd, entry) {
  try {
    appendLine(layout(cwd).events, Object.assign({ ts: new Date().toISOString() }, entry));
  } catch (_) {
    // Журнал недоступен (нет прав, диск) — обработчик всё равно не должен падать.
  }
}

function readAll(cwd) {
  try {
    const text = fs.readFileSync(layout(cwd).events, 'utf8');
    return text.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = { record, readAll, appendLine };
