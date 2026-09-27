#!/usr/bin/env node
'use strict';
// /compact-guard:doctor (план §9, минимальный вариант этапа A).
// Таблица ✅/❌ и одна финальная строка. Каждое ❌ — с одним конкретным действием.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'cg-hook.js');
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'live');

const rows = [];
function check(name, fn, fixHint) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    if (r && typeof r === 'object') { ok = !!r.ok; detail = r.detail || ''; }
    else { ok = !!r; }
  } catch (e) {
    ok = false;
    detail = String((e && e.message) || e);
  }
  rows.push({ name, ok, detail, fix: ok ? '' : (fixHint || '') });
  return ok;
}

function nodeMajor() {
  return Number(process.versions.node.split('.')[0]);
}

function runHook(event, fixtureFile, dataDir) {
  const input = fs.readFileSync(path.join(FIXTURES, fixtureFile), 'utf8');
  const res = spawnSync(process.execPath, [HOOK, event], {
    input,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir }),
    timeout: 20000
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-doctor-'));

  check('Node.js ≥ 20', () => ({ ok: nodeMajor() >= 20, detail: 'найден v' + process.versions.node }),
    'поставь Node.js 20 или новее — https://nodejs.org');

  check('claude в PATH', () => {
    const v = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
    let ok = true;
    let note = v;
    if (m) {
      const num = Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]);
      if (num < 2 * 1e6 + 1 * 1e3 + 283) { ok = true; note = v + ' (проверено на 2.1.283, старее может отличаться)'; }
    }
    return { ok, detail: note };
  }, 'запусти doctor из установленного Claude Code');

  check('каталог данных пишется', () => {
    const { layout, ensureDir } = require(path.join(ROOT, 'scripts', 'lib', 'paths.js'));
    process.env.CLAUDE_PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA || tmp;
    const l = layout(process.cwd());
    ensureDir(l.root);
    const probe = path.join(l.root, '.doctor-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true, detail: l.root };
  }, 'проверь права на каталог данных или задай CLAUDE_PLUGIN_DATA');

  check('hooks.json валиден, скрипты на месте', () => {
    const cfgPath = path.join(ROOT, 'hooks', 'hooks.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const events = Object.keys(cfg.hooks || {});
    if (!events.length) return { ok: false, detail: 'нет ни одного события' };
    if (!fs.existsSync(HOOK)) return { ok: false, detail: 'нет scripts/cg-hook.js' };
    for (const ev of events) {
      for (const group of cfg.hooks[ev]) {
        for (const h of group.hooks || []) {
          if (!/cg-hook\.js/.test(h.command || '')) return { ok: false, detail: ev + ': команда не указывает на cg-hook.js' };
        }
      }
    }
    return { ok: true, detail: events.join(', ') };
  }, 'проверь hooks/hooks.json');

  const fixturesOk = check('фикстуры живых событий на месте', () => {
    const need = ['SessionStart-startup.json', 'SessionStart-compact.json', 'PostCompact-manual.json',
      'PostToolUseFailure-bash-exit3.json', 'Stop-first.json', 'Stop-active.json'];
    const missing = need.filter((f) => !fs.existsSync(path.join(FIXTURES, f)));
    return { ok: missing.length === 0, detail: missing.length ? 'нет: ' + missing.join(', ') : need.length + ' шт.' };
  }, 'восстанови test/fixtures/live из репозитория');

  if (fixturesOk) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-doctor-run-'));
    const cases = [
      ['SessionStart', 'SessionStart-startup.json'],
      ['SessionStart', 'SessionStart-compact.json'],
      ['PostToolUseFailure', 'PostToolUseFailure-bash-exit3.json'],
      ['PostCompact', 'PostCompact-manual.json'],
      ['Stop', 'Stop-first.json'],
      ['Stop', 'Stop-active.json']
    ];
    for (const [ev, fx] of cases) {
      check('прогон ' + ev + ' (' + fx + ')', () => {
        const r = runHook(ev, fx, dir);
        if (r.code !== 0) return { ok: false, detail: 'exit ' + r.code + ' ' + r.stderr.slice(0, 200) };
        if (r.stdout.trim()) {
          try { JSON.parse(r.stdout); } catch (_) { return { ok: false, detail: 'stdout не JSON' }; }
        }
        return { ok: true, detail: r.stdout.trim() ? 'JSON на stdout' : 'тихо' };
      }, 'посмотри events.jsonl в каталоге данных');
    }

    check('PostCompact отдаёт compact_summary', () => {
      const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'PostCompact-manual.json'), 'utf8'));
      const has = typeof raw.compact_summary === 'string' && raw.compact_summary.length > 0;
      return { ok: has, detail: has ? raw.compact_summary.length + ' символов' : 'поля нет' };
    }, 'обнови Claude Code: PostCompact без compact_summary работает только по транскрипту');

    check('Ревизор блокирует, когда ошибка не раскрыта', () => {
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-doctor-rev-'));
      runHook('PostToolUseFailure', 'PostToolUseFailure-bash-exit3.json', dir2);
      // exit 3 — команда `exit 3`, значимость minor, поэтому в lite Ревизор молчит.
      // Проверяем сам механизм: подсовываем major-запись напрямую.
      const { layout } = require(path.join(ROOT, 'scripts', 'lib', 'paths.js'));
      const saved = process.env.CLAUDE_PLUGIN_DATA;
      process.env.CLAUDE_PLUGIN_DATA = dir2;
      const l = layout('/home/user/project');
      process.env.CLAUDE_PLUGIN_DATA = saved;
      fs.mkdirSync(l.root, { recursive: true });
      fs.appendFileSync(l.ledger, JSON.stringify({
        id: 'e_9001', ts: new Date().toISOString(), session_id: '49763b61-4ba8-49ca-a3d5-744dc61d4f98',
        tool: 'Bash', kind: 'nonzero_exit', significance: 'major', signature: 'npm test',
        command: 'npm test', exit_code: 1, detail: 'Exit code 1', count: 1, status: 'open'
      }) + '\n');
      const r = runHook('Stop', 'Stop-first.json', dir2);
      let decision = null;
      try { decision = JSON.parse(r.stdout).decision; } catch (_) { decision = null; }
      return { ok: decision === 'block', detail: 'decision=' + decision };
    }, 'посмотри events.jsonl: Ревизор должен вернуть decision=block');
  }

  let cfgMode = 'lite';
  check('режим из config.json', () => {
    const cfg = require(path.join(ROOT, 'scripts', 'lib', 'config.js')).load(process.cwd());
    cfgMode = cfg.mode;
    return { ok: true, detail: cfg.mode };
  }, 'проверь config.json в каталоге данных');

  // Инспектор-2 работает только в strict и только через дочерний `claude -p`.
  check('Инспектор-2 (режим ' + cfgMode + ')', () => {
    if (cfgMode !== 'strict') {
      return { ok: true, detail: 'режим lite, Инспектор-2 выключен' };
    }
    const v = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
    return { ok: true, detail: '`claude -p` доступен (' + v + '), модель по умолчанию haiku' };
  }, 'strict требует `claude` в PATH: либо поставь Claude Code в PATH, либо верни режим lite ' +
     '(/compact-guard:mode lite)');

  check('подкоманда cmd:report отрабатывает', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-doctor-report-'));
    const res = spawnSync(process.execPath, [HOOK, 'cmd:report'], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dir, CLAUDE_PROJECT_DIR: dir }),
      timeout: 20000
    });
    if (res.status !== 0) {
      return { ok: false, detail: 'exit ' + res.status + ' ' + String(res.stderr || '').slice(0, 200) };
    }
    const text = String(res.stdout || '').trim();
    if (!text) return { ok: false, detail: 'пустой вывод' };
    return { ok: true, detail: text.split('\n')[0].slice(0, 80) };
  }, 'запусти `node scripts/cg-hook.js cmd:report` и посмотри ошибку');

  const width = Math.max.apply(null, rows.map((r) => r.name.length));
  console.log('Compact Guard · doctor');
  console.log('');
  for (const r of rows) {
    console.log((r.ok ? '✅ ' : '❌ ') + r.name.padEnd(width) + '  ' + (r.detail || ''));
    if (!r.ok && r.fix) console.log('   → ' + r.fix);
  }
  console.log('');
  const bad = rows.filter((r) => !r.ok);
  if (!bad.length) {
    console.log('Compact Guard работает. Режим: ' + cfgMode + '.');
    process.exit(0);
  }
  console.log('Нужно: ' + (bad[0].fix || bad[0].name));
  process.exit(1);
}

main();
