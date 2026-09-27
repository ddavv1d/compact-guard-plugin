'use strict';
// Значимость команды и эвристики упавших тестов (план §3, §2).

// Сигнатура: команда без ведущих `cd … &&`, без обёрток вроде `( … ) 2>&1 | tail -c N`
// (их добавляют хуки-ограничители вывода в чужих настройках — живая проверка 27.09.2026),
// схлопнутые пробелы, обрезка до 200 символов.
function signature(command) {
  let s = typeof command === 'string' ? command : '';
  s = s.replace(/\r/g, ' ').replace(/\n/g, ' ');

  for (let pass = 0; pass < 5; pass++) {
    const before = s;
    // Ведущие `cd … &&` / `cd … ;`
    s = s.replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|[^&;|]+?)\s*(?:&&|;)\s*/i, '');
    // Обёртка `( … ) 2>&1 | tail…` / `( … ) | head…`: берём то, что внутри скобок.
    const wrapped = /^\s*\(\s*([\s\S]+?)\s*\)\s*(?:\d?>&\d|>&\d|2>&1)?\s*(?:\|\s*(?:tail|head|cat|tee)\b[^|]*)?\s*$/i.exec(s);
    if (wrapped) s = wrapped[1];
    if (s === before) break;
  }

  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, 200);
}

function hasAny(haystackLower, patterns) {
  for (const p of patterns || []) {
    if (typeof p !== 'string' || !p) continue;
    if (haystackLower.includes(p.toLowerCase())) return true;
  }
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Токен паттерна встречается в команде по границам слов, а не подстрокой.
// Подстрочная проверка давала ложные major на `latest`, `fastest`, `attestation`
// (все содержат `test`) — дефект 12 отчёта verify-v1. Граница слова здесь — не \b:
// в `docker build` и `cargo test` внутри паттерна есть пробел, а в `npm ci` — тоже,
// поэтому паттерн целиком оборачивается в собственные границы.
// Разделителем считается всё, что не буква, не цифра, не `_` и не `-`: так
// `npm run test:unit` и `pytest -k x` ловятся, а `attestation` — нет.
const TOKEN_EDGE = '[^A-Za-z0-9_-]';

function matchesToken(haystackLower, pattern) {
  const p = pattern.toLowerCase().trim();
  if (!p) return false;
  const re = new RegExp('(?:^|' + TOKEN_EDGE + ')' + escapeRe(p) + '(?:$|' + TOKEN_EDGE + ')');
  return re.test(haystackLower);
}

function hasAnyToken(haystackLower, patterns) {
  for (const p of patterns || []) {
    if (typeof p !== 'string' || !p) continue;
    if (matchesToken(haystackLower, p)) return true;
  }
  return false;
}

// Значимость команды Bash/PowerShell.
// Список minor проверяется первым и только по началу команды: `test -f`, `grep`, `ls`
// содержат подстроки из списка major («test», «ls»), но ненулевой код для них — норма,
// а не ошибка. Всё, что не попало ни в один список, считается minor.
function commandSignificance(command, cfg) {
  const sig = signature(command).toLowerCase();
  if (!sig) return 'minor';
  const head = sig.replace(/^(?:sudo|env|time|nice)\s+/, '');
  for (const p of (cfg && cfg.minor_patterns) || []) {
    if (typeof p !== 'string' || !p) continue;
    if (head.startsWith(p.toLowerCase())) return 'minor';
  }
  if (hasAnyToken(sig, cfg && cfg.major_patterns)) return 'major';
  return 'minor';
}

// Значимость ошибки не-Bash инструмента: minor, кроме перечисленных в конфиге.
function toolSignificance(toolName, cfg) {
  const list = (cfg && cfg.major_tools) || [];
  return list.some((t) => String(t).toLowerCase() === String(toolName || '').toLowerCase()) ? 'major' : 'minor';
}

// `Exit code N` из первой строки поля error (SPIKE S2).
function parseExitCode(errorText) {
  if (typeof errorText !== 'string') return null;
  const m = /^\s*Exit code\s+(\d+)/im.exec(errorText);
  return m ? Number(m[1]) : null;
}

// Код выхода замаскирован (`|| true`, `; echo …`, `|| echo`, `; true`) — план §2.
function exitCodeMasked(command) {
  const s = signature(command);
  return /\|\|\s*(true|echo|:)\b/i.test(s) || /;\s*(echo|true|exit\s+0)\b/i.test(s) || /\|\s*tee\b/i.test(s);
}

// Мог ли код выхода значимой части команды не доехать до Claude Code?
// Это условие применения эвристик по выводу (дефект 11-Д3 отчёта verify-v1):
// на чистой команде с exit 0 вывод не проверяется вообще, иначе успешный `npm test`
// со строкой «✗ skipped 1» становился открытой major-ошибкой и блокировал завершение хода.
//
// Маскировка возможна, если после значимой части команды стоит:
//  - конвейер `|` (код берётся от последней команды конвейера);
//  - `||` или `;` (код берётся от последней команды списка);
//  - `&&`-цепочка, завершающаяся `echo`/`true`/`tail`/`head`/`cat`/`tee`;
//  - обёртка `( … ) 2>&1 | …` — её `signature()` разворачивает, поэтому проверяется
//    исходная строка команды, а не сигнатура.
function exitCodeMayBeMasked(command) {
  const raw = typeof command === 'string' ? command.replace(/[\r\n]+/g, ' ') : '';
  if (!raw.trim()) return false;

  // Обёртка `( … ) 2>&1 | tail…`: код выхода — от `tail`, не от команды внутри.
  if (/^\s*\(\s*[\s\S]+\)\s*(?:\d?>&\d|2>&1)?\s*\|/.test(raw)) return true;
  // `( … ) | …` без перенаправления — тот же случай.
  if (/^\s*\(\s*[\s\S]+\)\s*\|/.test(raw)) return true;

  // Дальше работаем с сигнатурой: без ведущих `cd … &&` и без внешней обёртки.
  const s = signature(command);
  if (!s) return false;

  // Конвейер: `npm test | tail -c 24000`.
  if (/\|(?!\|)/.test(s)) return true;
  // Список команд: `npm test || true`, `npm test; echo done`.
  if (/\|\|/.test(s)) return true;
  if (/;/.test(s)) return true;
  // `&&`-цепочка, последнее звено которой не влияет на успех значимой части.
  if (/&&/.test(s)) {
    const tail = s.split(/&&/).pop().trim().toLowerCase();
    if (/^(?:echo|true|:|tail|head|cat|tee)\b/.test(tail)) return true;
  }
  return false;
}

function compileTestPatterns(cfg) {
  const out = [];
  for (const p of (cfg && cfg.test_failure_patterns) || []) {
    try { out.push(new RegExp(p, 'i')); } catch (_) { /* битый паттерн из конфига игнорируем */ }
  }
  return out;
}

// Эвристика упавших тестов в stdout успешной значимой команды.
function looksLikeTestFailure(stdout, cfg) {
  if (typeof stdout !== 'string' || !stdout) return null;
  for (const re of compileTestPatterns(cfg)) {
    const m = re.exec(stdout);
    if (m) return m[0];
  }
  return null;
}

// Признаки провала в выводе команды, которую Claude Code счёл успешной.
// Нужно потому, что живая проверка 27.09.2026 показала: один и тот же упавший
// `npm test` в одной сессии приходит как PostToolUseFailure, а в другой — как
// PostToolUse с is_error=false. Полагаться только на PostToolUseFailure нельзя.
const ERROR_MARKERS = [
  /^\s*npm\s+error\s+code\s+\S+/im,
  /^\s*npm\s+ERR!\s+code\s+\S+/im,
  /^\s*yarn\s+error\b/im,
  /\berror\s+TS\d+\b/i,
  /(?:^|\n)\s*error\s*:/im,
  /(?:^|\n)\s*fatal:\s/im,
  /(?:^|\n)\s*Traceback \(most recent call last\)/im,
  /\b(?:command not found|No such file or directory)\b/i,
  /(?:^|\n)\s*ENOENT\b/im,
  /(?:^|\n)\s*Segmentation fault\b/im
];

// Вывод значимой команды выглядит как провал. Возвращает найденный маркер или null.
function looksLikeFailure(output, cfg) {
  if (typeof output !== 'string' || !output) return null;
  const testHit = looksLikeTestFailure(output, cfg);
  if (testHit) return testHit;
  for (const re of ERROR_MARKERS) {
    const m = re.exec(output);
    if (m) return m[0].trim().slice(0, 120);
  }
  return null;
}

module.exports = {
  signature,
  commandSignificance,
  toolSignificance,
  parseExitCode,
  exitCodeMasked,
  exitCodeMayBeMasked,
  looksLikeTestFailure,
  looksLikeFailure,
  matchesToken,
  ERROR_MARKERS
};
