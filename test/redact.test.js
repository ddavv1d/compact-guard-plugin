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

// ——— дефект 5-Д1 verify-v1: имя-ключ с префиксом не маскировалось ———
//
// Правило начиналось с `\b(password|…)`, а перед `PASSWORD` в `DB_PASSWORD` стоит `_`,
// который сам является символом слова: границы там нет, и вся конвенция env-переменных
// с префиксом проходила в ledger открытым текстом.

const PREFIXED_KEYS = [
  ['DB_PASSWORD через двоеточие', 'DB_PASSWORD: ' + 'hunter22'],
  ['APP_TOKEN через равно', 'APP_TOKEN=' + 'abcdef1234567890'],
  ['MY_SECRET', 'MY_SECRET=' + 'topSecretValue'],
  ['PG_PASSWORD в команде', 'env PG_PASSWORD=' + 'pa55w0rd' + ' psql -h db'],
  ['x-api-key как заголовок', 'header x-api-key: ' + 'abcdef123456'],
  ['секрет во флаге команды', 'npm run deploy -- --token=' + 'gh' + 'p_BBBBBBBBBBBBBBBBBBBB'],
  ['SERVICE_AUTH', 'SERVICE_AUTH=' + 'Basic0abcdef'],
  ['DB_CREDENTIAL', 'DB_CREDENTIAL=' + 'xyz1234567'],
  ['имя с точками', 'service.account.password=' + 'sekret1'],
  ['REFRESH_TOKEN', 'REFRESH_TOKEN=' + 'abcdefghij123456'],
  ['CI_API_KEY', 'CI_API_KEY=' + 'abcdef0123456789']
];

for (const [name, sample] of PREFIXED_KEYS) {
  test('маскируется имя-ключ с префиксом: ' + name, () => {
    const out = redact(sample);
    assert.ok(out.includes(MASK), 'не замаскировано: ' + out);
  });
}

test('пароль в URL маскируется для разных схем', () => {
  const urls = [
    'postgres://appuser:' + 'sUperSecret1' + '@db.internal:5432/app',
    'mysql://root:' + 'r00tpass' + '@127.0.0.1/db',
    'https://ci:' + 'deployKey9' + '@example.com/repo.git',
    'amqp://guest:' + 'guestPass1' + '@rabbit:5672/'
  ];
  for (const u of urls) {
    const out = redact(u);
    assert.ok(out.includes(MASK), 'не замаскировано: ' + out);
    assert.ok(!/:[^\s@/]*@/.test(out.replace(MASK, '')) || out.includes(MASK));
  }
});

test('приватный ключ маскируется целым блоком PEM', () => {
  const DASH = '-----';
  const begin = DASH + 'BEGIN RSA PRIVATE KEY' + DASH;
  const end = DASH + 'END RSA PRIVATE KEY' + DASH;
  const body = 'MIIEowIBAAKCAQEA1234\nabcdEFGHijkl\nmnopQRSTuvwx';
  const out = redact('cat keyfile\n' + begin + '\n' + body + '\n' + end + '\nException');
  assert.ok(out.includes(MASK), 'блок не замаскирован: ' + out);
  assert.ok(!out.includes('MIIEowIBAAKCAQEA1234'), 'тело ключа осталось: ' + out);
  assert.ok(!out.includes(begin), 'заголовок ключа остался: ' + out);
  // Текст вокруг блока сохраняется.
  assert.ok(out.includes('cat keyfile'));
  assert.ok(out.includes('Exception'));
});

test('незакрытый блок приватного ключа маскируется до конца текста', () => {
  const DASH = '-----';
  const begin = DASH + 'BEGIN OPENSSH PRIVATE KEY' + DASH;
  const out = redact('cat keyfile\n' + begin + '\nb3BlbnNzaC1rZXktdjEA');
  assert.ok(out.includes(MASK));
  assert.ok(!out.includes('b3BlbnNzaC1rZXktdjEA'), 'тело ключа осталось: ' + out);
});

test('JWT маскируется', () => {
  const jwt = 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.' + 'ey' + 'JzdWIiOiIxMjM0NSJ9' + '.' + 'dBjftJeZ4CVPmB92K27u';
  assert.ok(redact('token ' + jwt).includes(MASK));
});

test('маскирование идемпотентно: повторный прогон ничего не ломает', () => {
  const samples = [
    'DB_PASSWORD: ' + 'hunter22',
    'пароль: ' + 'xyz123456',
    'Authorization: Bearer ' + 'abcdef1234567890',
    'Authorization: ' + 'Basic0YWxhZGRpbg',
    'sent Bearer ' + 'abcdef1234567890abc',
    'postgres://u:' + 'p455word' + '@h/db',
    'npm run deploy -- --token=' + 'gh' + 'p_BBBBBBBBBBBBBBBBBBBB'
  ];
  for (const s of samples) {
    const once = redact(s);
    assert.equal(redact(once), once, 'повторный прогон изменил результат: ' + once);
    // И маска не разорвана на части.
    assert.ok(!/«секрет скрыт»\s+скрыт»/.test(once), 'маска разорвана: ' + once);
  }
});

test('слова-ключи без значения безобидный текст не портят', () => {
  const samples = [
    'the token is missing from the request',
    'passwords are stored hashed in the database',
    'failed to authorize the request, retry later',
    'cannot read /home/user/project/package.json'
  ];
  for (const s of samples) assert.equal(redact(s), s, 'изменён безобидный текст: ' + s);
});
