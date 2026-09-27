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
  if (hasAny(sig, cfg && cfg.major_patterns)) return 'major';
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
  looksLikeTestFailure,
  looksLikeFailure,
  ERROR_MARKERS
};
