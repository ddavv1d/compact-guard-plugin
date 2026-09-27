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
