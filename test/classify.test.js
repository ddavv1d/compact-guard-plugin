'use strict';
// Сигнатура, значимость, парсер Exit code, эвристика упавших тестов (план §3).

const test = require('node:test');
const assert = require('node:assert');
const classify = require('../scripts/lib/classify');
const config = require('../scripts/lib/config');

const cfg = config.defaults();

test('сигнатура снимает ведущие cd … &&', () => {
  assert.equal(classify.signature('cd /home/user/project && npm test'), 'npm test');
  assert.equal(classify.signature('cd "/path with space" && npm run build'), 'npm run build');
  assert.equal(classify.signature('cd a && cd b && pytest -q'), 'pytest -q');
  assert.equal(classify.signature('cd /tmp; npm test'), 'npm test');
});

test('сигнатура схлопывает пробелы и переводы строк', () => {
  assert.equal(classify.signature('npm    test\n--silent'), 'npm test --silent');
  assert.equal(classify.signature('  npm test  '), 'npm test');
});

test('сигнатура снимает обёртку ограничителя вывода', () => {
  // Живая проверка 27.09.2026: чужой хук переписал команду в `( npm test ) 2>&1 | tail -c 24000`.
  assert.equal(classify.signature('( npm test ) 2>&1 | tail -c 24000'), 'npm test');
  assert.equal(classify.signature('( npm run build ) 2>&1 | head -n 200'), 'npm run build');
  assert.equal(classify.signature('(pytest -q) | tail -c 100'), 'pytest -q');
  assert.equal(classify.signature('cd /srv && ( npm test ) 2>&1 | tail -c 24000'), 'npm test');
  // Скобки без ограничителя не трогаем сверх нужного.
  assert.equal(classify.signature('( npm test )'), 'npm test');
  // Настоящий конвейер не ломается.
  assert.equal(classify.signature('npm test | tail -c 100'), 'npm test | tail -c 100');
});

test('сигнатура обрезается до 200 символов', () => {
  const long = 'echo ' + 'a'.repeat(400);
  assert.equal(classify.signature(long).length, 200);
});

test('сигнатура от нестроки — пустая строка', () => {
  assert.equal(classify.signature(null), '');
  assert.equal(classify.signature(undefined), '');
});

test('значимые команды помечаются major', () => {
  const major = ['npm test', 'npx jest', 'pytest -q', 'vitest run', 'go test ./...', 'cargo test',
    'npm run build', 'tsc --noEmit', 'npm run lint', 'eslint src', 'ruff check .', 'mypy src',
    'npx prisma migrate dev', 'alembic upgrade head', 'docker build -t app .', 'make all',
    'npm ci', 'pip install -r requirements.txt', './deploy.sh'];
  for (const c of major) {
    assert.equal(classify.commandSignificance(c, cfg), 'major', 'должно быть major: ' + c);
  }
});

test('бытовые команды помечаются minor', () => {
  const minor = ['grep -r foo .', 'which node', 'ls -la', 'git diff --exit-code', 'git status',
    'test -f package.json', 'find . -name "*.js"', 'cat README.md', 'echo hi', 'exit 3'];
  for (const c of minor) {
    assert.equal(classify.commandSignificance(c, cfg), 'minor', 'должно быть minor: ' + c);
  }
});

test('cd перед значимой командой не мешает значимости', () => {
  assert.equal(classify.commandSignificance('cd /srv/app && npm test', cfg), 'major');
});

test('значимость ошибки не-Bash инструмента: minor по умолчанию', () => {
  assert.equal(classify.toolSignificance('Read', cfg), 'minor');
  assert.equal(classify.toolSignificance('WebFetch', cfg), 'minor');
});

test('major_tools из конфига поднимает значимость', () => {
  const custom = config.deepMerge(config.defaults(), { major_tools: ['Write'] });
  assert.equal(classify.toolSignificance('Write', custom), 'major');
  assert.equal(classify.toolSignificance('write', custom), 'major');
  assert.equal(classify.toolSignificance('Read', custom), 'minor');
});

test('Exit code читается из первой строки error', () => {
  assert.equal(classify.parseExitCode('Exit code 3'), 3);
  assert.equal(classify.parseExitCode('Exit code 1\nError: Cannot find module'), 1);
  assert.equal(classify.parseExitCode('exit code 127\n...'), 127);
  assert.equal(classify.parseExitCode('Command failed'), null);
  assert.equal(classify.parseExitCode(null), null);
});

test('замаскированный код выхода распознаётся', () => {
  assert.ok(classify.exitCodeMasked('npm test || true'));
  assert.ok(classify.exitCodeMasked('npm test || echo done'));
  assert.ok(classify.exitCodeMasked('pytest ; echo finished'));
  assert.ok(classify.exitCodeMasked('npm test | tee out.log'));
  assert.ok(!classify.exitCodeMasked('npm test'));
  assert.ok(!classify.exitCodeMasked('npm test --silent'));
});

test('эвристика упавших тестов ловит типовые строки', () => {
  const hits = [
    'Tests: 3 failed, 10 passed',
    'FAILED tests/test_auth.py::test_login',
    '2 failed',
    'AssertionError: expected 1 to equal 2',
    'npm ERR! Test failed.  See above for more details.',
    'Error: Cannot find module \'./missing\'',
    '✗ 3 tests failed'
  ];
  for (const h of hits) {
    assert.ok(classify.looksLikeTestFailure(h, cfg), 'не поймано: ' + h);
  }
});

// Дефект 11-Д3 verify-v1: одиночный «✗» и слово «failing» убраны из дефолтных паттернов —
// они ловили пропущенные тесты и обычный текст вывода.
test('эвристика молчит на пропущенных тестах и одиночном ✗', () => {
  // «1 failing» в списке не значится намеренно: паттерн `\d+\s+failing` оставлен как
  // сильный признак. Убрано только одиночное слово `failing` без числа.
  const clean = [
    'All tests passed ✗ skipped 1',
    '✗ auth returns 401',
    'the failing test suite was fixed earlier in this session',
    'webpack compiled with 0 errors'
  ];
  for (const c of clean) {
    assert.equal(classify.looksLikeTestFailure(c, cfg), null, 'ложное срабатывание: ' + c);
  }
});

test('эвристика молчит на успешном выводе', () => {
  const clean = ['Tests: 13 passed, 13 total', 'All checks passed', 'Build succeeded', ''];
  for (const c of clean) {
    assert.equal(classify.looksLikeTestFailure(c, cfg), null, 'ложное срабатывание: ' + c);
  }
});

test('провал в выводе «успешной» команды распознаётся', () => {
  // Живая проверка 27.09.2026: упавший npm test пришёл как PostToolUse с is_error=false.
  const npmEnoent = [
    'npm error code ENOENT',
    'npm error syscall open',
    'npm error path /tmp/project/package.json',
    'npm error enoent Could not read package.json'
  ].join('\n');
  assert.ok(classify.looksLikeFailure(npmEnoent, cfg), 'ENOENT от npm должен считаться провалом');
  assert.ok(classify.looksLikeFailure('npm ERR! code ELIFECYCLE', cfg));
  assert.ok(classify.looksLikeFailure('src/a.ts(3,1): error TS2304: Cannot find name', cfg));
  assert.ok(classify.looksLikeFailure('fatal: not a git repository', cfg));
  assert.ok(classify.looksLikeFailure('Traceback (most recent call last):\n  File "a.py"', cfg));
  assert.ok(classify.looksLikeFailure('bash: foo: command not found', cfg));
  assert.ok(classify.looksLikeFailure('Tests: 3 failed, 10 passed', cfg), 'упавшие тесты тоже провал');
});

test('чистый вывод не считается провалом', () => {
  const clean = [
    'Tests: 13 passed, 13 total\nDone in 2.1s',
    'Build succeeded in 4s',
    'added 120 packages in 3s',
    'up to date, audited 500 packages',
    ''
  ];
  for (const c of clean) {
    assert.equal(classify.looksLikeFailure(c, cfg), null, 'ложное срабатывание: ' + JSON.stringify(c));
  }
});

test('битый паттерн из конфига не ломает эвристику', () => {
  const bad = config.deepMerge(config.defaults(), { test_failure_patterns: ['(((', 'FAILED'] });
  assert.equal(classify.looksLikeTestFailure('FAILED something', bad), 'FAILED');
});

// ——— дефект 12 verify-v1: подстрока `test` внутри слова давала ложный major ———

test('значимость считается по токенам, а не по подстроке', () => {
  // `latest`, `fastest`, `attestation` содержат `test`, но значимыми командами не являются.
  for (const c of ['latest', 'fastest', 'attestation', 'echo latest', 'echo attestation done']) {
    assert.equal(classify.commandSignificance(c, cfg), 'minor', 'должно быть minor: ' + c);
  }
  // Настоящие значимые команды по-прежнему major.
  for (const c of ['npm test', 'pytest', 'cargo test', 'go test ./...', 'npm run test:unit',
    'pytest -k login', 'npm run build', 'eslint .', 'npm ci']) {
    assert.equal(classify.commandSignificance(c, cfg), 'major', 'должно быть major: ' + c);
  }
});

test('matchesToken требует границы слова с двух сторон', () => {
  assert.ok(classify.matchesToken('npm test', 'test'));
  assert.ok(classify.matchesToken('npm run test:unit', 'test'));
  assert.ok(classify.matchesToken('cd x && cargo test', 'cargo test'));
  assert.ok(!classify.matchesToken('latest', 'test'));
  assert.ok(!classify.matchesToken('attestation', 'test'));
  assert.ok(!classify.matchesToken('fastest', 'test'));
});

// ——— дефект 11-Д3 verify-v1: эвристики только при возможной маскировке кода выхода ———

test('маскировка кода выхода: конвейеры, списки и обёртки', () => {
  const masked = [
    '( npm test ) 2>&1 | tail -c 24000',
    '( npm test ) | head -50',
    'npm test | tail -c 24000',
    'npm test || true',
    'npm test || echo failed',
    'pytest ; echo finished',
    'npm test && echo done',
    'npm run build && tail -5 out.log'
  ];
  for (const c of masked) {
    assert.ok(classify.exitCodeMayBeMasked(c), 'должна быть возможна маскировка: ' + c);
  }
});

test('чистая команда — маскировки нет', () => {
  const clean = [
    'npm test',
    'npm test --silent',
    'pytest -k login',
    'cd /srv/app && npm test',
    'npm ci && npm test'
  ];
  for (const c of clean) {
    assert.ok(!classify.exitCodeMayBeMasked(c), 'маскировки быть не должно: ' + c);
  }
});
