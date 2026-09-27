'use strict';
// Парсер блока «### Ошибки сессии» и решение Ревизора (план §4, §8).

const test = require('node:test');
const assert = require('node:assert');
const revisor = require('../scripts/lib/revisor');
const ledger = require('../scripts/lib/ledger');

function row(over) {
  return Object.assign({
    id: 'e_0007', kind: 'nonzero_exit', significance: 'major', status: 'open',
    tool: 'Bash', signature: 'npm test', command: 'npm test', exit_code: 1, session_id: 's1'
  }, over || {});
}

test('блок находится при разном числе решёток и регистре', () => {
  const variants = [
    '# Ошибки сессии\n- [e_0007] npm test → exit 1',
    '## ошибки сессии\n- e_0007 npm test',
    '### ОШИБКИ СЕССИИ\n- e_0007',
    '#### Ошибки сессии:\n- e_0007',
    '### **Ошибки сессии**\n- e_0007',
    '###   Ошибки   сессии   \n- e_0007'
  ];
  for (const v of variants) {
    const b = revisor.extractBlock('Готово.\n\n' + v);
    assert.ok(b, 'не найден блок в: ' + JSON.stringify(v.split('\n')[0]));
    assert.ok(b.body.includes('e_0007'));
  }
});

test('блок обрывается на следующем заголовке того же уровня', () => {
  const msg = '### Ошибки сессии\n- e_0007 npm test\n\n### Что дальше\n- e_9999 не относится';
  const b = revisor.extractBlock(msg);
  assert.ok(b.body.includes('e_0007'));
  assert.ok(!b.body.includes('e_9999'));
});

test('вложенный заголовок глубже уровня остаётся в блоке', () => {
  const msg = '## Ошибки сессии\n- e_0007\n### Подробности\n- e_0008';
  const b = revisor.extractBlock(msg);
  assert.ok(b.body.includes('e_0008'));
});

test('без заголовка блока нет', () => {
  assert.equal(revisor.extractBlock('Просто готово, без разделов.'), null);
  assert.equal(revisor.extractBlock(''), null);
  assert.equal(revisor.extractBlock(null), null);
  // «Ошибки» без «сессии» не считается
  assert.equal(revisor.extractBlock('### Ошибки\n- e_0007'), null);
});

test('id распознаётся во всех вариантах написания', () => {
  for (const form of ['[e_0007]', 'e_0007', 'e-0007', 'e0007', 'E_0007', '`e_0007`', '**e_0007**']) {
    assert.ok(revisor.idPresent('- ' + form + ' npm test → exit 1', 'e_0007'), 'не распознан: ' + form);
  }
});

test('чужой id не считается раскрытым', () => {
  assert.ok(!revisor.idPresent('- [e_0008] tsc → exit 2', 'e_0007'));
  assert.ok(!revisor.idPresent('- [e_00071] что-то', 'e_0007'));
  assert.ok(!revisor.idPresent('', 'e_0007'));
});

// ——— дефект 4-Д1: пробел между буквой и цифрами раскрытием не считается ———

test('id: ведущие нули не обязательны, форма — без пробела', () => {
  const positives = [
    '[e_0001]', 'e_0001', 'e-0001', 'e0001', 'E_0001', 'e_1', 'e_01', 'e1',
    '**e_0001**', '`e_0001`', '- [e_0001] npm test', '(e_0001)', '«e_0001»',
    'e_0001: упало', 'e_0001, дальше e_0002', 'исправлено e_0001.', 'см. [E-1] выше'
  ];
  for (const s of positives) {
    assert.ok(revisor.idPresent(s, 'e_0001'), 'позитив не распознан: ' + JSON.stringify(s));
  }
});

test('id: «шаг e 1» и прочий случайный текст раскрытием не считаются', () => {
  // `see e1` в список не входит намеренно: `e1` — законная форма записи id,
  // и пробел перед буквой — допустимая граница. Ловим только пробел ВНУТРИ id.
  const negatives = [
    'шаг e 1', 'step E 1', 'e 0001', 'e  1', 'see_0001', 'see1',
    'e_00011', 'e_10001', 'xe_0001', 'e_0001x', 'note_0001', '0001'
  ];
  for (const s of negatives) {
    assert.ok(!revisor.idPresent(s, 'e_0001'), 'негатив сработал: ' + JSON.stringify(s));
  }
});

test('id: «ошибок нет, см. шаг e 1» не закрывает e_0001 сквозным решением', () => {
  const msg = 'Готово.\n\n### Ошибки сессии\n- ошибок нет, всё прошло. см. шаг e 1';
  const v = revisor.decide(
    { last_assistant_message: msg },
    [row({ id: 'e_0001' })],
    { mode: 'lite', revisor: { enabled: true, max_retries: 2 } },
    0
  );
  assert.equal(v.decision, 'block', 'Ревизор пропустил ход без раскрытия');
  assert.deepEqual(v.missing.map((r) => r.id), ['e_0001']);
});

// ——— дефект 4-Д2: заголовок с хвостом и без решёток ———

test('заголовок распознаётся со счётчиком, двоеточием и без решёток', () => {
  const headings = [
    '### Ошибки сессии',
    '### Ошибки сессии (1)',
    '### Ошибки сессии:',
    '### Ошибки сессии [2]',
    '## Ошибки сессии — 2',
    '## Ошибки сессии - 1',
    '**Ошибки сессии**',
    'Ошибки сессии:',
    'Ошибки сессии',
    '###### ошибки сессии'
  ];
  for (const h of headings) {
    const b = revisor.extractBlock('Готово.\n\n' + h + '\n- [e_0007] npm test → exit 1');
    assert.ok(b, 'заголовок не найден: ' + JSON.stringify(h));
    assert.ok(b.body.includes('e_0007'), 'тело пустое для: ' + JSON.stringify(h));
  }
});

test('заголовок с посторонним текстом после названия не считается', () => {
  for (const h of ['### Ошибки сессии не было ничего', '### Ошибки сессии и что дальше', '### Ошибки']) {
    assert.equal(revisor.extractBlock(h + '\n- e_0007'), null, 'ложный заголовок: ' + JSON.stringify(h));
  }
});

test('раздел «### Ошибки сессии (1)» с корректной строкой → pass, а не вечный блок', () => {
  const msg = 'Готово.\n\n### Ошибки сессии (1)\n- [e_0001] npm test -> упало';
  const v = revisor.decide(
    { last_assistant_message: msg },
    [row({ id: 'e_0001' })],
    { mode: 'lite', revisor: { enabled: true, max_retries: 2 } },
    0
  );
  assert.equal(v.decision, 'pass');
  assert.equal(v.note, 'all_disclosed');
});

test('раздел «**Ошибки сессии**» без решёток тоже принимается', () => {
  const msg = 'Готово.\n\n**Ошибки сессии**\n- [e_0001] npm test -> упало';
  const v = revisor.decide(
    { last_assistant_message: msg },
    [row({ id: 'e_0001' })],
    { mode: 'lite', revisor: { enabled: true, max_retries: 2 } },
    0
  );
  assert.equal(v.decision, 'pass');
});

test('раздел без решёток обрывается на следующем заголовке', () => {
  const b = revisor.extractBlock('**Ошибки сессии**\n- e_0007\n\n## Что дальше\n- e_9999');
  assert.ok(b.body.includes('e_0007'));
  assert.ok(!b.body.includes('e_9999'));
});

test('lite: обязательны только значимые открытые', () => {
  const rows = [
    row({ id: 'e_0001', significance: 'major', status: 'open' }),
    row({ id: 'e_0002', significance: 'minor', status: 'open' }),
    row({ id: 'e_0003', significance: 'major', status: 'resolved' }),
    row({ id: 'e_0004', kind: 'compaction', significance: 'minor', status: 'open' })
  ];
  const req = revisor.requiredRows(rows, 'lite').map((r) => r.id);
  assert.deepEqual(req, ['e_0001']);
});

test('strict: обязательны все, кроме acknowledged и компакций', () => {
  const rows = [
    row({ id: 'e_0001', significance: 'major', status: 'open' }),
    row({ id: 'e_0002', significance: 'minor', status: 'open' }),
    row({ id: 'e_0003', significance: 'major', status: 'resolved' }),
    row({ id: 'e_0005', significance: 'minor', status: 'acknowledged' }),
    row({ id: 'e_0004', kind: 'compaction', status: 'open' })
  ];
  const req = revisor.requiredRows(rows, 'strict').map((r) => r.id);
  assert.deepEqual(req, ['e_0001', 'e_0002', 'e_0003']);
});

test('решение: нет раздела при обязательной ошибке → block', () => {
  const v = revisor.decide({ last_assistant_message: 'готово' }, [row()], { mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, 0);
  assert.equal(v.decision, 'block');
  assert.equal(v.note, 'no_section');
  assert.equal(v.missing.length, 1);
});

test('решение: раздел со всеми id → pass', () => {
  const msg = 'Готово.\n\n### Ошибки сессии\n- [e_0007] npm test → exit 1, не исправлено';
  const v = revisor.decide({ last_assistant_message: msg }, [row()], { mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, 0);
  assert.equal(v.decision, 'pass');
  assert.equal(v.note, 'all_disclosed');
});

test('решение: раздел есть, но id не хватает → block', () => {
  const rows = [row({ id: 'e_0007' }), row({ id: 'e_0008', signature: 'tsc' })];
  const msg = '### Ошибки сессии\n- [e_0007] npm test → exit 1';
  const v = revisor.decide({ last_assistant_message: msg }, rows, { mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, 0);
  assert.equal(v.decision, 'block');
  assert.deepEqual(v.missing.map((r) => r.id), ['e_0008']);
});

test('решение: ошибок нет → pass без требований к формату', () => {
  const v = revisor.decide({ last_assistant_message: 'готово' }, [], { mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, 0);
  assert.equal(v.decision, 'pass');
  assert.equal(v.note, 'nothing_required');
});

test('решение: пустой last_assistant_message → skip', () => {
  const v = revisor.decide({ last_assistant_message: '' }, [row()], { mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, 0);
  assert.equal(v.decision, 'skip');
  assert.equal(v.note, 'empty_last_assistant_message');
});

test('решение: лимит попыток → revisor_gave_up, не блок', () => {
  const v = revisor.decide({ last_assistant_message: 'готово' }, [row()], { mode: 'lite', revisor: { enabled: true, max_retries: 2 } }, 2);
  assert.equal(v.decision, 'skip');
  assert.equal(v.note, 'revisor_gave_up');
});

test('решение: Ревизор выключен в конфиге → skip', () => {
  const v = revisor.decide({ last_assistant_message: 'готово' }, [row()], { mode: 'lite', revisor: { enabled: false } }, 0);
  assert.equal(v.decision, 'skip');
  assert.equal(v.note, 'revisor_disabled');
});

test('текст требования называет id и команду', () => {
  const reason = revisor.blockReason([row()], ledger.describe);
  assert.match(reason, /e_0007/);
  assert.match(reason, /npm test/);
  assert.match(reason, /### Ошибки сессии/);
});
