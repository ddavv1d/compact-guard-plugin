'use strict';
// Ledger: append-only, сведение статусов по id, дедуп по сигнатуре, ротация (план §3).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Каталог данных задаётся через CLAUDE_PLUGIN_DATA, поэтому модуль подключается после env.
function freshLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ledger-'));
  process.env.CLAUDE_PLUGIN_DATA = dir;
  // paths.js читает env на каждом вызове, кэша нет — пере-require не нужен.
  return { dir, ledger: require('../scripts/lib/ledger'), paths: require('../scripts/lib/paths') };
}

const CWD = '/tmp/cg-test-project';

test('id монотонный и в формате e_0001', () => {
  const { ledger } = freshLedger();
  assert.equal(ledger.nextId(CWD), 'e_0001');
  assert.equal(ledger.nextId(CWD), 'e_0002');
  assert.equal(ledger.nextId(CWD), 'e_0003');
});

test('запись ошибки читается обратно со всеми полями', () => {
  const { ledger } = freshLedger();
  const res = ledger.recordError(CWD, {
    session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major',
    command: 'npm test', exit_code: 1, detail: 'Exit code 1\nthree tests failed'
  });
  const rows = ledger.forSession(CWD, 's1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, res.id);
  assert.equal(rows[0].signature, 'npm test');
  assert.equal(rows[0].significance, 'major');
  assert.equal(rows[0].exit_code, 1);
  assert.equal(rows[0].status, 'open');
  assert.equal(rows[0].count, 1);
});

test('секрет в detail маскируется при записи', () => {
  const { ledger } = freshLedger();
  ledger.recordError(CWD, {
    session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major',
    command: 'psql', detail: 'auth failed password=' + 'superSecret123'
  });
  const rows = ledger.forSession(CWD, 's1');
  assert.ok(!rows[0].detail.includes('superSecret123'));
  assert.match(rows[0].detail, /секрет скрыт/);
});

test('дедуп: та же сигнатура в той же сессии → count++, id тот же', () => {
  const { ledger } = freshLedger();
  const a = ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', detail: 'Exit code 1' });
  const b = ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'cd /x && npm test', detail: 'Exit code 1' });
  assert.equal(a.id, b.id);
  assert.ok(b.deduped);
  const rows = ledger.forSession(CWD, 's1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
});

test('дедупа нет между разными сессиями', () => {
  const { ledger } = freshLedger();
  const a = ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', detail: 'x' });
  const b = ledger.recordError(CWD, { session_id: 's2', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', detail: 'x' });
  assert.notEqual(a.id, b.id);
});

test('статус меняется новой строкой, файл не перезаписывается', () => {
  const { ledger, paths } = freshLedger();
  const r = ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', detail: 'x' });
  const before = fs.readFileSync(paths.layout(CWD).ledger, 'utf8');
  ledger.setStatus(CWD, r.id, 'resolved');
  const after = fs.readFileSync(paths.layout(CWD).ledger, 'utf8');
  assert.ok(after.startsWith(before), 'старое содержимое должно остаться нетронутым');
  assert.equal(ledger.forSession(CWD, 's1')[0].status, 'resolved');
});

test('успешный повтор закрывает запись по сигнатуре', () => {
  const { ledger } = freshLedger();
  const r = ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', detail: 'x' });
  const closed = ledger.resolveBySignature(CWD, 's1', 'npm test', 'Bash');
  assert.deepEqual(closed, [r.id]);
  assert.equal(ledger.openForSession(CWD, 's1').length, 0);
});

test('отметка компакции не попадает в открытые ошибки', () => {
  const { ledger } = freshLedger();
  ledger.recordCompaction(CWD, { session_id: 's1', trigger: 'manual' });
  assert.equal(ledger.openForSession(CWD, 's1').length, 0);
  assert.equal(ledger.forSession(CWD, 's1').length, 1);
});

test('битые строки ledger не ломают чтение', () => {
  const { ledger, paths } = freshLedger();
  ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', detail: 'x' });
  fs.appendFileSync(paths.layout(CWD).ledger, 'не json\n\n');
  assert.equal(ledger.forSession(CWD, 's1').length, 1);
});

test('describe даёт читаемую строку', () => {
  const { ledger } = freshLedger();
  const r = ledger.recordError(CWD, { session_id: 's1', tool: 'Bash', kind: 'nonzero_exit', significance: 'major', command: 'npm test', exit_code: 1, detail: 'x' });
  const row = ledger.forSession(CWD, 's1')[0];
  assert.equal(ledger.describe(row), r.id + ' npm test → exit 1');
});

test('ротация удаляет чужие старые сессии и щадит текущую', () => {
  const { ledger, paths } = freshLedger();
  const old = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  fs.mkdirSync(paths.layout(CWD).root, { recursive: true });
  fs.appendFileSync(paths.layout(CWD).ledger,
    JSON.stringify({ id: 'e_0900', ts: old, session_id: 'old-session', kind: 'nonzero_exit', significance: 'major', signature: 'old', status: 'open' }) + '\n' +
    JSON.stringify({ id: 'e_0901', ts: old, session_id: 'current', kind: 'nonzero_exit', significance: 'major', signature: 'mine', status: 'open' }) + '\n');
  ledger.rotate(CWD, { retention: { days: 30 } }, 'current');
  const ids = ledger.readMerged(CWD).map((r) => r.id);
  assert.ok(!ids.includes('e_0900'), 'старая чужая запись должна уйти');
  assert.ok(ids.includes('e_0901'), 'запись текущей сессии должна остаться');
});

test('ротация на пустом каталоге не падает', () => {
  const { ledger } = freshLedger();
  assert.doesNotThrow(() => ledger.rotate(CWD, { retention: { days: 30 } }, 's1'));
});
