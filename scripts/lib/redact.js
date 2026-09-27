'use strict';
// Маскирование секретов в detail перед записью в ledger (план §3, ТЗ §2.2).
// Задача — не пропустить ключ в журнал, а не построить идеальный детектор.

// Имя-ключ с любым префиксом и суффиксом: `DB_PASSWORD`, `APP_TOKEN`, `MY_SECRET`,
// `x-api-key`, `service.account.password`. Раньше правило начиналось с `\b(password|…)`,
// а перед `PASSWORD` в `DB_PASSWORD` стоит `_`, который сам является символом слова —
// границы там нет, и вся конвенция env-переменных с префиксом проходила открытым текстом
// (дефект 5-Д1 отчёта verify-v1).
const KEYISH_NAME =
  '[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth|credential)[A-Za-z0-9_.-]*';

// Значение: строка в кавычках целиком либо всё до пробела.
// `(?!«)` не даёт повторно разобрать уже поставленную маску: в «секрет скрыт» есть пробел,
// и без этой защиты второе правило откусывало от неё половину.
const KEYISH_VALUE = '(?!«)("[^"\\n]*"|\'[^\'\\n]*\'|\\S+)';

const RULES = [
  // Приватные ключи целым блоком PEM: от BEGIN до END включительно, вместе с телом.
  // Многострочное правило, поэтому идёт раньше остальных — иначе тело ключа
  // разберут на части другие правила.
  [/-----BEGIN (?:[A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]*)PRIVATE KEY-----/g,
    '«секрет скрыт»'],
  // Незакрытый блок (вывод обрезан) — маскируем всё до конца текста.
  [/-----BEGIN (?:[A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*$/g, '«секрет скрыт»'],
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
  // Заголовок целиком, вместе со схемой: `Authorization: Bearer …`, `Authorization: Basic …`.
  // Раньше сначала срабатывало правило Bearer, потом `Authorization:\s*\S+` откусывало
  // от готовой маски половину, и выходило ««секрет скрыт» скрыт»».
  [/\bAuthorization\s*:\s*(?!«)\S+(?:[ \t]+(?!«)[A-Za-z0-9._\-~+/=]+)?/gi, 'Authorization: «секрет скрыт»'],
  [/\bBearer\s+(?!«)[A-Za-z0-9._\-~+/=]{8,}/gi, 'Bearer «секрет скрыт»'],
  // Общие ключ=значение. Имя-ключ с любым префиксом и суффиксом: `DB_PASSWORD: hunter22`,
  // `APP_TOKEN=…`, `MY_SECRET=…`, `--token=…`, `x-api-key: …`.
  // Границу слева даёт lookbehind по «не символ имени»: сам KEYISH_NAME уже жадно
  // забирает префикс, поэтому разрез посередине слова невозможен.
  [new RegExp('(?<![A-Za-z0-9_.-])(' + KEYISH_NAME + ')\\s*[=:]\\s*' + KEYISH_VALUE, 'gi'),
    '$1=«секрет скрыт»'],
  // Кириллица: \b по ASCII не работает — юникодный lookbehind.
  [/(?<![\p{L}\p{N}_])(парол\p{L}*|секрет\p{L}*|токен\p{L}*|ключ\p{L}*)\s*[=:]\s*(?!«)("[^"\n]*"|'[^'\n]*'|\S+)/giu,
    '$1: «секрет скрыт»'],
  // Строка подключения: часть между двоеточием и «собакой» вырезается.
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
