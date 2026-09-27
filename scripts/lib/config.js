'use strict';
// config.json в каталоге данных проекта. Режимы lite|strict (план §0, §4).
// Читается на каждом событии; отсутствует или битый — молча берутся дефолты.

const fs = require('fs');
const path = require('path');
const { layout, ensureDir } = require('./paths');

const DEFAULTS = {
  mode: 'lite', // lite | strict
  revisor: { enabled: true, max_retries: 2 },
  // Значимость команд (план §3). Подстроки, регистр не важен.
  major_patterns: [
    'test', 'jest', 'vitest', 'pytest', 'mocha', 'cargo test', 'go test',
    'build', 'tsc', 'lint', 'eslint', 'ruff', 'mypy',
    'migrate', 'prisma', 'alembic', 'deploy', 'docker build', 'make',
    'npm ci', 'npm install', 'pip install'
  ],
  // Команды, которые ненулевым кодом сообщают результат, а не ошибку.
  minor_patterns: [
    'grep', 'rg ', 'which ', 'ls ', 'git diff', 'git status',
    'test -', '[ -', 'diff ', 'cmp ', 'find '
  ],
  // Инструменты (кроме Bash/PowerShell), чья ошибка считается значимой.
  major_tools: [],
  // Эвристики упавших тестов в stdout успешной команды (план §2).
  test_failure_patterns: ['FAILED', 'FAIL ', 'failing', 'AssertionError', '\\d+ failed', '✗', 'Tests:\\s+\\d+ failed'],
  retention: { days: 30, max_bytes: 50 * 1024 * 1024 },
  // enabled: null = «не задано» — в strict Инспектор-2 включается, в lite выключен.
  // Явный false в config.json выключает его и в strict.
  inspector2: { enabled: null, timeout_ms: 30000, model: 'haiku' },
  notify: { telegram: { enabled: false, bot_token_env: 'CG_TG_TOKEN', chat_id_env: 'CG_TG_CHAT' } }
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(over)) {
    const b = out[k];
    const o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) {
      out[k] = deepMerge(b, o);
    } else if (o !== undefined && o !== null) {
      out[k] = o;
    }
  }
  return out;
}

function defaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function load(cwd) {
  const paths = layout(cwd);
  let user = null;
  try {
    user = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
  } catch (_) {
    user = null;
  }
  const cfg = deepMerge(defaults(), user);
  if (cfg.mode !== 'strict') cfg.mode = 'lite';
  if (!cfg.revisor || typeof cfg.revisor !== 'object') cfg.revisor = defaults().revisor;
  if (typeof cfg.revisor.max_retries !== 'number' || cfg.revisor.max_retries < 0) cfg.revisor.max_retries = 2;
  if (!cfg.inspector2 || typeof cfg.inspector2 !== 'object') cfg.inspector2 = defaults().inspector2;
  // Инспектор-2 работает только в strict; явный false в config.json выключает его и там.
  cfg.inspector2.enabled = cfg.mode === 'strict' && cfg.inspector2.enabled !== false;
  return cfg;
}

// Записать дефолтный config.json, если его ещё нет (делает SessionStart:startup).
function ensureDefaultFile(cwd) {
  const paths = layout(cwd);
  ensureDir(path.dirname(paths.config));
  if (!fs.existsSync(paths.config)) {
    fs.writeFileSync(paths.config, JSON.stringify({ mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, null, 2) + '\n');
    return true;
  }
  return false;
}

module.exports = { DEFAULTS, defaults, load, ensureDefaultFile, deepMerge };
