'use strict';
// Ревизор (план §4). Единственный обработчик, который может остановить завершение хода.
// Решение принимается только по фактам ledger и по тексту last_assistant_message.

// Заголовок раздела. Принимаются варианты:
//   `### Ошибки сессии`, `### Ошибки сессии (1)`, `### Ошибки сессии:`,
//   `**Ошибки сессии**`, `Ошибки сессии:` в начале строки.
// Любое число `#` (или ни одного), регистр не важен, лишние пробелы допустимы.
// Хвост после названия — счётчик в скобках, двоеточие, тире, звёздочки: агент, добавивший
// «(1)», раскрытие всё равно сделал, и блокировать его до max_retries нельзя (дефект 4-Д2).
const HEADING_RE = /^[ \t]*(#{1,6}[ \t]*)?\**[ \t]*ошибки\s+сессии[ \t]*\**[ \t]*(?:[:—–-]?[ \t]*(?:\([^)\n]*\)|\[[^\]\n]*\]|\d+))*[ \t]*[:—–-]?[ \t]*\**[ \t]*:?[ \t]*$/im;

// Уровень заголовка: число решёток, либо 7 (ниже любого `#`-заголовка) для `**…**` и `Текст:`.
// Раздел без решёток обрывается на первом же `#`-заголовке — так и задумано.
function headingLevel(headingText) {
  const h = /^[ \t]*(#{1,6})/.exec(headingText);
  return h ? h[1].length : 7;
}

// Вырезать блок раздела: от заголовка до следующего заголовка того же или более высокого
// уровня (то есть с не большим числом решёток), либо до конца сообщения.
function extractBlock(message) {
  if (typeof message !== 'string' || !message) return null;
  const m = HEADING_RE.exec(message);
  if (!m) return null;
  const level = headingLevel(m[0]);
  const start = m.index + m[0].length;
  const rest = message.slice(start);
  const lines = rest.split('\n');
  const body = [];
  for (const line of lines) {
    const h = /^[ \t]*(#{1,6})[ \t]+\S/.exec(line);
    if (h && h[1].length <= level) break;
    body.push(line);
  }
  return { heading: m[0].trim(), body: body.join('\n').trim(), level };
}

// Границы вокруг id. Перед: начало строки, пробел, `[`, `(`, `«`, `"`, `` ` ``.
// После: конец строки, пробел, `]`, `)`, `»`, `"`, `` ` ``, `:`, `,`, `.`, `;`.
// Звёздочки Markdown (`**e_0007**`) тоже допускаются с обеих сторон.
const ID_BEFORE = '(?:^|[\\s\\[(«"`*])';
const ID_AFTER = '(?=$|[\\s\\])»"`*:,.;])';

// Варианты написания id: `e_0007`, `e-0007`, `e0007`, с необязательными `[ ]`, регистр не важен.
// Ведущие нули могут отсутствовать (`e_1` = `e_0001`), но пробел между буквой и цифрами
// недопустим: «шаг e 1» и «e 0001» раскрытием не считаются (дефект 4-Д1).
function idPresent(block, id) {
  if (typeof block !== 'string' || !block) return false;
  const num = /^e[_-]?(\d+)$/i.exec(String(id || ''));
  if (!num) return false;
  const digits = num[1];
  const bare = digits.replace(/^0+/, '') || '0';
  // Число целиком: `0*<значимые цифры>` — так `e_1`, `e_01`, `e_0001` равны, а `e_00011` нет.
  const number = '0*' + bare;
  const re = new RegExp(ID_BEFORE + '\\[?e[_-]?' + number + '\\]?' + ID_AFTER, 'i');
  return re.test(block);
}

// Обязательные к раскрытию записи (план §4 п.2).
function requiredRows(rows, mode) {
  const usable = (rows || []).filter((r) => r && r.kind !== 'compaction');
  if (mode === 'strict') {
    return usable.filter((r) => r.status !== 'acknowledged');
  }
  return usable.filter((r) => r.significance === 'major' && r.status === 'open');
}

// Текст требования агенту.
function blockReason(missing, describe) {
  const list = missing.map((r) => describe(r)).join(', ');
  return 'Compact Guard / Ревизор: не раскрыты ошибки: ' + list +
    '. Добавь в конец ответа раздел «### Ошибки сессии» со строкой на каждую ошибку: ' +
    '[id] команда → что случилось, исправлено или нет. ' +
    'Исправленные по ходу можно перечислить одной строкой «исправлено по ходу: N».';
}

// Основное решение. Возвращает {decision:'pass'|'block'|'skip', reason, missing, required, note}.
function decide(input, rows, cfg, attempts) {
  const mode = cfg && cfg.mode === 'strict' ? 'strict' : 'lite';
  if (cfg && cfg.revisor && cfg.revisor.enabled === false) {
    return { decision: 'skip', note: 'revisor_disabled' };
  }
  const message = input && typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
  const required = requiredRows(rows, mode);
  if (!required.length) {
    return { decision: 'pass', required: [], missing: [], note: 'nothing_required' };
  }
  // Ход завершился без текста — требовать нечего (план §4, последний абзац).
  if (!message.trim()) {
    return { decision: 'skip', required, missing: [], note: 'empty_last_assistant_message' };
  }
  const maxRetries = (cfg && cfg.revisor && cfg.revisor.max_retries) || 2;
  if (attempts >= maxRetries) {
    return { decision: 'skip', required, missing: required, note: 'revisor_gave_up' };
  }
  const block = extractBlock(message);
  if (!block) {
    return { decision: 'block', required, missing: required, note: 'no_section', reason: null };
  }
  const missing = required.filter((r) => !idPresent(block.body, r.id));
  if (missing.length) {
    return { decision: 'block', required, missing, note: 'ids_missing', block };
  }
  return { decision: 'pass', required, missing: [], note: 'all_disclosed', block };
}

module.exports = { extractBlock, idPresent, requiredRows, blockReason, decide, HEADING_RE };
