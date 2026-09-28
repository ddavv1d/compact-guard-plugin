'use strict';
// Адаптер транскрипта (SPIKE S1, план §8): строковый и блочный content, битые строки,
// несколько компакций в одном файле, отсутствие резюме.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const transcript = require('../scripts/lib/transcript');

function writeJsonl(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-transcript-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  return file;
}

function boundary(trigger) {
  return { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger, preTokens: 540008, postTokens: 39251 } };
}

function summaryRow(text) {
  return {
    type: 'user',
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: text }
  };
}

function summaryBlocks(parts) {
  return {
    type: 'user',
    isCompactSummary: true,
    message: { role: 'user', content: parts.map((t) => ({ type: 'text', text: t })) }
  };
}

test('резюме со строковым content находится', () => {
  const file = writeJsonl([
    { type: 'user', message: { role: 'user', content: 'привет' } },
    boundary('manual'),
    summaryRow('This session is being continued… ## 4. Ошибки\n- e_0007 npm test → exit 1')
  ]);
  const found = transcript.lastSummary(file);
  assert.ok(found);
  assert.match(found.text, /e_0007/);
  assert.equal(found.trigger, 'manual');
});

test('резюме с массивом блоков собирается в текст', () => {
  const file = writeJsonl([boundary('auto'), summaryBlocks(['первая часть', 'вторая часть'])]);
  const found = transcript.lastSummary(file);
  assert.match(found.text, /первая часть/);
  assert.match(found.text, /вторая часть/);
  assert.equal(found.trigger, 'auto');
});

test('служебные строки между границей и резюме не мешают', () => {
  const file = writeJsonl([
    boundary('manual'),
    { type: 'system', subtype: 'other' },
    { type: 'system', subtype: 'another' },
    summaryRow('резюме после служебных строк')
  ]);
  assert.match(transcript.lastSummary(file).text, /после служебных строк/);
});

test('берётся последнее резюме, а не первое', () => {
  const file = writeJsonl([
    boundary('auto'), summaryRow('старое резюме'),
    { type: 'assistant', message: { role: 'assistant', content: 'работа' } },
    boundary('manual'), summaryRow('новое резюме')
  ]);
  const found = transcript.lastSummary(file);
  assert.match(found.text, /новое резюме/);
  assert.equal(found.trigger, 'manual');
});

test('битые строки пропускаются', () => {
  const file = writeJsonl(['{это не json', boundary('manual'), '', summaryRow('нормальное резюме')]);
  assert.match(transcript.lastSummary(file).text, /нормальное резюме/);
});

test('резюме без границы находится как fallback', () => {
  const file = writeJsonl([summaryRow('резюме без границы')]);
  assert.match(transcript.lastSummary(file).text, /без границы/);
});

test('нет резюме — null', () => {
  const file = writeJsonl([{ type: 'user', message: { role: 'user', content: 'привет' } }]);
  assert.equal(transcript.lastSummary(file), null);
});

test('нет файла — null, без исключения', () => {
  assert.equal(transcript.lastSummary('/nope/nope/nope.jsonl'), null);
  assert.equal(transcript.lastSummary(null), null);
  assert.equal(transcript.lastSummary(''), null);
});

test('пустое резюме считается отсутствующим', () => {
  const file = writeJsonl([boundary('manual'), summaryRow('   ')]);
  assert.equal(transcript.lastSummary(file), null);
});

test('блок analysis убирается из сырого резюме', () => {
  const raw = '<analysis>\nвнутренние рассуждения\n</analysis>\nThis session is being continued…';
  const clean = transcript.stripAnalysis(raw);
  assert.ok(!clean.includes('внутренние рассуждения'));
  assert.match(clean, /This session is being continued/);
});

test('живая фикстура PostCompact содержит блок analysis', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'live', 'PostCompact-manual.json'), 'utf8'));
  assert.equal(typeof fixture.compact_summary, 'string');
  assert.match(fixture.compact_summary, /<analysis>/);
  const clean = transcript.stripAnalysis(fixture.compact_summary);
  assert.ok(clean.length > 0);
  assert.ok(!clean.includes('<analysis>'));
});

test('contentToText терпит неожиданные формы', () => {
  assert.equal(transcript.contentToText('строка'), 'строка');
  assert.equal(transcript.contentToText([{ type: 'text', text: 'a' }, { type: 'image' }]), 'a');
  assert.equal(transcript.contentToText({ text: 'объект' }), 'объект');
  assert.equal(transcript.contentToText(null), '');
  assert.equal(transcript.contentToText(42), '');
});

test('stripAnalysis убирает и обёртку <summary>…</summary>', () => {
  const raw = '<analysis>мысли</analysis>\n\n<summary>\nCG-MARKER\n\n### Ошибки сессии\n- [e_0001] npm test\n</summary>';
  const clean = transcript.stripAnalysis(raw);
  assert.ok(!/<\/?summary>/i.test(clean), clean);
  assert.ok(!/analysis/.test(clean));
  assert.ok(clean.startsWith('CG-MARKER'), clean);
});
