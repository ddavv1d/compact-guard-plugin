'use strict';
// Маскирование секретов в detail перед записью в ledger (план §3, ТЗ §2.2).
// Задача — не пропустить ключ в журнал, а не построить идеальный детектор.

const RULES = [
  // AWS access key id и secret access key
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '«секрет скрыт»'],
  [/\baws_secret_access_key\s*[=:]\s*\S+/gi, 'aws_secret_access_key=«секрет скрыт»'],
  // OpenAI / Anthropic
  [/\bsk-ant-[A-Za-z0-9_\-]{10,}/g, '«секрет скрыт»'],
  [/\bsk-proj-[A-Za-z0-9_\-]{10,}/g, '«секрет скрыт»'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, '«секрет скрыт»'],
  // GitHub
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '«секрет скрыт»'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '«секрет скрыт»'],
  // Google / Slack / Stripe
  [/\bAIza[0-9A-Za-z_\-]{30,}\b/g, '«секрет скрыт»'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '«секрет скрыт»'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, '«секрет скрыт»'],
  // JWT
  [/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g, '«секрет скрыт»'],
  // Bearer / Authorization
  [/\bBearer\s+[A-Za-z0-9._\-~+/=]{8,}/gi, 'Bearer «секрет скрыт»'],
  [/\bAuthorization\s*:\s*\S+/gi, 'Authorization: «секрет скрыт»'],
  // Общие ключ=значение. Для кириллицы \b не работает — юникодный lookbehind.
  [/\b(password|passwd|pwd)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=«секрет скрыт»'],
  [/(?<![\p{L}\p{N}_])(парол\p{L}*|секрет\p{L}*|токен\p{L}*|ключ\p{L}*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/giu, '$1: «секрет скрыт»'],
  [/\b(token|api[_-]?key|apikey|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=«секрет скрыт»'],
  // Строка подключения: часть между двоеточием и «собакой» вырезается
  [/\b([a-z][a-z0-9+.\-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, '$1:«секрет скрыт»@']
];

function redact(text) {
  if (typeof text !== 'string' || text === '') return text;
  let out = text;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}

// detail в ledger: маскируем и обрезаем (план §3: ≤ 2000 символов).
function redactDetail(text, limit) {
  const max = typeof limit === 'number' ? limit : 2000;
  const cleaned = redact(typeof text === 'string' ? text : String(text == null ? '' : text));
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max) + '… (обрезано)';
}

module.exports = { redact, redactDetail, RULES };
