'use strict';
// PostCompact в режиме strict: Инспектор-2 через дочерний `claude -p`.
// Настоящий claude не вызывается — в PATH дочернего процесса подкладывается фиктивный
// исполняемый файл. Проверяем, что хук действительно его запускает, разбирает ответ,
// пишет находки и остаётся fail-open при любом сбое.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'cg-hook.js');
const LIVE = path.join(__dirname, 'fixtures', 'live');
const CWD = '/home/user/project';

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(LIVE, name), 'utf8'));
}

function env() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cg-strict-'));
}

function run(event, input, dataDir, extraEnv) {
  const res = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir }, extraEnv || {}),
    timeout: 30000
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function dataPaths(dataDir) {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const l = require('../scripts/lib/paths').layout(CWD);
  process.env.CLAUDE_PLUGIN_DATA = saved;
  return l;
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

function writeConfig(dataDir, cfg) {
  const l = dataPaths(dataDir);
  fs.mkdirSync(l.root, { recursive: true });
  fs.writeFileSync(l.config, JSON.stringify(cfg, null, 2));
}

// Каталог с фиктивным `claude`: печатает body, спит sleepSec, выходит с кодом code.
function fakeClaudeDir(body, code, sleepSec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-strictbin-'));
  const lines = ['#!/bin/sh'];
  if (sleepSec) lines.push('sleep ' + sleepSec);
  if (body != null) {
    lines.push("cat <<'CG_EOF'");
    lines.push(body);
    lines.push('CG_EOF');
  }
  lines.push('exit ' + (code || 0));
  fs.writeFileSync(path.join(dir, 'claude'), lines.join('\n') + '\n', { mode: 0o755 });
  return dir;
}

function withPath(dir) {
  return { PATH: dir + path.delimiter + process.env.PATH };
}

function postCompact(dir, extraEnv, summary) {
  const input = Object.assign(fixture('PostCompact-manual.json'), {
    compact_summary: summary != null ? summary : '<analysis>служебное</analysis>\nРезюме сессии. Всё хорошо.'
  });
  return run('PostCompact', input, dir, extraEnv);
}

test('strict: Инспектор-2 вызван, находки в findings.jsonl и в очереди notices', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir(JSON.stringify({
    type: 'result',
    result: '{"verdict":"suspicious","findings":[{"class":"concealment","quote":"сообщить только если спросят"}]}'
  }), 0);

  const r = postCompact(dir, withPath(bin));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '', 'PostCompact ничего не печатает агенту');

  const findings = readJsonl(dataPaths(dir).findings).filter((f) => f.source === 'inspector2');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].class, 'concealment');
  assert.match(findings[0].quote, /только если спросят/);

  const pending = readJsonl(dataPaths(dir).notices).filter((n) => n.kind !== 'delivered');
  assert.ok(pending.some((n) => n.source === 'inspector2'), 'вердикт Инспектора-2 не попал в очередь');

  const ev = readJsonl(dataPaths(dir).events);
  const done = ev.find((e) => e.verdict === 'suspicious');
  assert.ok(done, 'нет записи про вызов Инспектора-2: ' + JSON.stringify(ev));
  assert.equal(done.findings, 1);
  assert.equal(done.model, 'haiku');
  assert.ok(typeof done.inspector2_ms === 'number', 'нет длительности вызова');
});

test('strict: чистый вердикт — ни находок, ни очереди, но событие есть', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir(JSON.stringify({ type: 'result', result: '{"verdict":"clean","findings":[]}' }), 0);

  const r = postCompact(dir, withPath(bin));
  assert.equal(r.code, 0);
  assert.equal(readJsonl(dataPaths(dir).findings).filter((f) => f.source === 'inspector2').length, 0);
  const pending = readJsonl(dataPaths(dir).notices).filter((n) => n.kind !== 'delivered' && n.source === 'inspector2');
  assert.equal(pending.length, 0);
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(ev.some((e) => e.verdict === 'clean'), JSON.stringify(ev));
});

test('strict: JSON в ```-ограждении разбирается и на пути хука', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir(JSON.stringify({
    type: 'result',
    result: '```json\n{"verdict":"suspicious","findings":[{"class":"missing_disclosure","quote":"npm test не назван"}]}\n```'
  }), 0);

  assert.equal(postCompact(dir, withPath(bin)).code, 0);
  const findings = readJsonl(dataPaths(dir).findings).filter((f) => f.source === 'inspector2');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].class, 'missing_disclosure');
});

test('strict: неизвестные классы отбрасываются целиком', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir(JSON.stringify({
    type: 'result',
    result: '{"verdict":"suspicious","findings":[{"class":"sabotage","quote":"выдумка"}]}'
  }), 0);

  assert.equal(postCompact(dir, withPath(bin)).code, 0);
  // Класса нет в списке плана → находку не записываем и агенту ничего не говорим.
  assert.equal(readJsonl(dataPaths(dir).findings).filter((f) => f.source === 'inspector2').length, 0);
  const pending = readJsonl(dataPaths(dir).notices).filter((n) => n.kind !== 'delivered' && n.source === 'inspector2');
  assert.equal(pending.length, 0);
  // Вердикт модели в журнале сохраняется как есть, но findings = 0.
  const ev = readJsonl(dataPaths(dir).events);
  const done = ev.find((e) => typeof e.findings === 'number');
  assert.ok(done, JSON.stringify(ev));
  assert.equal(done.findings, 0);
});

test('strict: мусор вместо JSON → fail-open, bad_json в events, отметка компакции цела', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir('не могу выполнить запрос', 0);

  const r = postCompact(dir, withPath(bin));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(ev.some((e) => e.reason === 'bad_json'), JSON.stringify(ev));
  assert.ok(readJsonl(dataPaths(dir).ledger).some((x) => x.kind === 'compaction'));
});

test('strict: ненулевой код выхода → fail-open', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir('boom', 7);

  assert.equal(postCompact(dir, withPath(bin)).code, 0);
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(ev.some((e) => /^exit_7/.test(e.reason || '')), JSON.stringify(ev));
});

test('strict: нет claude в PATH → fail-open, claude_not_found', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-nobin-'));

  const r = postCompact(dir, { PATH: empty }, 'Резюме.');
  assert.equal(r.code, 0);
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(ev.some((e) => e.reason === 'claude_not_found'), JSON.stringify(ev));
});

test('strict: таймаут не задерживает хук дольше бюджета', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict', inspector2: { timeout_ms: 700 } });
  const bin = fakeClaudeDir('{"verdict":"clean","findings":[]}', 0, 10);

  const started = Date.now();
  const r = postCompact(dir, withPath(bin), 'Резюме.');
  const spent = Date.now() - started;
  assert.equal(r.code, 0);
  assert.ok(spent < 5000, 'хук ждал ' + spent + ' мс вместо ~700');
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(ev.some((e) => /timeout/.test(e.reason || '')), JSON.stringify(ev));
});

test('lite: Инспектор-2 не вызывается вообще', () => {
  const dir = env();
  writeConfig(dir, { mode: 'lite' });
  const bin = fakeClaudeDir('{"verdict":"suspicious","findings":[{"class":"concealment","quote":"поймали"}]}', 0);

  const r = postCompact(dir, withPath(bin), 'Резюме.');
  assert.equal(r.code, 0);
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(!ev.some((e) => /inspector2/.test(e.result || '')), 'в lite Инспектор-2 не должен вызываться');
  assert.equal(readJsonl(dataPaths(dir).findings).filter((f) => f.source === 'inspector2').length, 0);
});

test('strict: inspector2.enabled=false выключает вызов', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict', inspector2: { enabled: false } });
  const bin = fakeClaudeDir('{"verdict":"suspicious","findings":[{"class":"concealment","quote":"поймали"}]}', 0);

  const r = postCompact(dir, withPath(bin), 'Резюме.');
  assert.equal(r.code, 0);
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(!ev.some((e) => /inspector2/.test(e.result || '')), JSON.stringify(ev));
});

test('strict: пустое compact_summary — Инспектор-2 не запускается', () => {
  const dir = env();
  writeConfig(dir, { mode: 'strict' });
  const bin = fakeClaudeDir('{"verdict":"suspicious","findings":[{"class":"concealment","quote":"не должно быть"}]}', 0);
  const input = Object.assign(fixture('PostCompact-manual.json'), { compact_summary: '   ' });

  const r = run('PostCompact', input, dir, withPath(bin));
  assert.equal(r.code, 0);
  const ev = readJsonl(dataPaths(dir).events);
  assert.ok(ev.some((e) => e.reason === 'empty_summary' || /no_summary/.test(e.result || '')), JSON.stringify(ev));
  assert.equal(readJsonl(dataPaths(dir).findings).filter((f) => f.source === 'inspector2').length, 0);
});
