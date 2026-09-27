'use strict';
// Маскирование секретов (план §3, ТЗ §6).
// Значения в примерах синтетические, взяты по форме, а не из реальных ключей.

const test = require('node:test');
const assert = require('node:assert');
const { redact, redactDetail } = require('../scripts/lib/redact');

const MASK = '«секрет скрыт»';

const CASES = [
  ['AWS access key', 'Exit code 1\nAKIA' + 'IOSFODNN7EXAMPLE' + ' rejected'],
  ['AWS secret', 'aws_secret_access_key=' + 'wJalrXUtnFEMI' + 'K7MDENGbPxRfiCYEXAMPLEKEY'],
  ['Anthropic key', 'using sk-ant-' + 'api03' + '-abcdefghijklmnop1234'],
  ['OpenAI project key', 'sk-proj-' + 'abcdefghijklmnopqrstuvwx1234'],
  ['generic sk key', 'sk-' + 'abcdefghijklmnopqrstuvwxyz0123'],
  ['GitHub token', 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123'],
  ['GitHub PAT', 'github_pat_' + 'abcdefghijklmnopqrstuvwxyz0123'],
  ['Google key', 'AIza' + 'SyAbCdEfGhIjKlMnOpQrStUvWxYz01234567'],
  ['Slack token', 'xoxb-' + '123456789012-abcdefghijkl'],
  ['Stripe key', 'sk_live_' + 'abcdefghij1234567890'],
  ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'],
  ['Bearer', 'Authorization header sent Bearer ' + 'abcdef1234567890abcdef'],
  ['password=', 'psql failed: password=' + 'hunter2secretvalue'],
  ['пароль:', 'ошибка входа, пароль: ' + 'oченьСекретно123'],
  ['token=', 'curl failed token=' + 'abcdef1234567890'],
  ['api_key=', 'config: api_key=' + 'abcdef1234567890'],
  ['client_secret', 'client_secret: ' + 'abcdef1234567890'],
  ['connection string', 'postgres://appuser:' + 'sUperSecret1' + '@db.internal:5432/app']
];

for (const [name, sample] of CASES) {
  test('маскируется: ' + name, () => {
    const out = redact(sample);
    assert.ok(out.includes(MASK), 'не замаскировано: ' + out);
  });
}

test('обычный текст не портится', () => {
  const samples = [
    'Exit code 1\nError: Cannot find module \'express\'',
    'npm test → 3 failing tests in auth.test.ts',
    'tsc --noEmit завершился с кодом 2',
    'файл scripts/lib/ledger.js изменён',
    'e_0007 npm test → exit 1'
  ];
  for (const s of samples) assert.equal(redact(s), s, 'изменён безобидный текст: ' + s);
});

test('не строка возвращается как есть', () => {
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(5), 5);
  assert.equal(redact(''), '');
});

test('detail обрезается до предела и помечается', () => {
  const long = 'x'.repeat(5000);
  const out = redactDetail(long);
  assert.ok(out.length <= 2000 + 20);
  assert.match(out, /обрезано/);
});

test('detail короче предела не трогается', () => {
  assert.equal(redactDetail('Exit code 3'), 'Exit code 3');
});

test('detail маскирует и обрезает одновременно', () => {
  const text = 'password=' + 'superSecretValue' + '\n' + 'y'.repeat(3000);
  const out = redactDetail(text, 100);
  assert.ok(out.includes(MASK));
  assert.ok(out.length <= 120);
});
