'use strict';
// Ревизор (план §4). Единственный обработчик, который может остановить завершение хода.
// Решение принимается только по фактам ledger и по тексту last_assistant_message.

// Заголовок «### Ошибки сессии»: любое число #, регистр не важен, допускаются ** и :.
const HEADING_RE = /^[ \t]*(#{1,6})[ \t]*\**[ \t]*ошибки\s+сессии[ \t]*\**[ \t]*:?[ \t]*$/im;

// Вырезать блок раздела: от заголовка до следующего заголовка того же или меньшего уровня.
function extractBlock(message) {
  if (typeof message !== 'string' || !message) return null;
  const m = HEADING_RE.exec(message);
  if (!m) return null;
  const level = m[1].length;
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

// Варианты написания id: [e_0007], e_0007, e-0007, e0007, E_0007.
function idPresent(block, id) {
  const num = /^e[_-]?(\d+)$/i.exec(id);
  if (!num) return false;
  const digits = num[1];
  const re = new RegExp('\\be[_\\-\\s]?0*' + digits.replace(/^0+/, '') + '\\b', 'i');
  const reExact = new RegExp('\\be[_\\-\\s]?' + digits + '\\b', 'i');
  return reExact.test(block) || re.test(block);
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
