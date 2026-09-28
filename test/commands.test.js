'use strict';
// Подкоманды скиллов `cg-hook.js cmd:<name>`: init show/apply/повтор/remove, report, mode.
// Запуск дочерним процессом, как это делает скилл. CLAUDE_PROJECT_DIR и CLAUDE_PLUGIN_DATA —
// временные каталоги, настоящий CLAUDE.md пользователя не трогается.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'cg-hook.js');
const instructor = require('../scripts/lib/instructor');

const SESSION = '49763b61-4ba8-49ca-a3d5-744dc61d4f98';

// Свои каталоги на каждый тест: проект (для CLAUDE.md) и данные плагина.
function sandbox() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cmd-proj-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cmd-data-'));
  return { proj, data };
}

function cmd(box, name, args) {
  const res = spawnSync(process.execPath, [HOOK, 'cmd:' + name].concat(args || []), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      CLAUDE_PLUGIN_DATA: box.data,
      CLAUDE_PROJECT_DIR: box.proj
    }),
    timeout: 20000
  });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

function dataPaths(box) {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = box.data;
  const l = require('../scripts/lib/paths').layout(box.proj);
  process.env.CLAUDE_PLUGIN_DATA = saved;
  return l;
}

const mdPath = (box) => path.join(box.proj, 'CLAUDE.md');

// ——— init --preview (и синоним --show) ———

test('init --preview: файла нет — печатает путь и блок, ничего не пишет', () => {
  const box = sandbox();
  const r = cmd(box, 'init', ['--preview']);
  assert.strictEqual(r.code, 0);
  assert.ok(r.out.includes(mdPath(box)), 'нет абсолютного пути к CLAUDE.md');
  assert.ok(r.out.includes(instructor.CLAUDE_MD_START));
  assert.ok(r.out.includes(instructor.CLAUDE_MD_END));
  assert.ok(r.out.includes('# Compact instructions'));
  // Текст — из instructor.js (claudeMdBlock), единый источник.
  assert.ok(r.out.includes(instructor.claudeMdBlock()), 'блок не дословно из instructor.claudeMdBlock()');
  assert.ok(/Файла нет/.test(r.out), 'не сказано, что файл будет создан');
  assert.ok(!fs.existsSync(mdPath(box)), '--preview не должен создавать файл');
});

test('init --show — синоним --preview, ведёт себя так же', () => {
  const box = sandbox();
  const a = cmd(box, 'init', ['--show']);
  const b = cmd(box, 'init', ['--preview']);
  assert.strictEqual(a.code, 0);
  assert.strictEqual(a.out, b.out);
  assert.ok(!fs.existsSync(mdPath(box)));
});

test('init без флагов — это предпросмотр, exit 0, ничего не пишет', () => {
  const box = sandbox();
  const r = cmd(box, 'init', []);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out, cmd(box, 'init', ['--preview']).out);
  assert.ok(!fs.existsSync(mdPath(box)), 'без --apply файл создаваться не должен');
});

test('init --preview на существующем файле без блока это сообщает', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Проект\n');
  const r = cmd(box, 'init', ['--preview']);
  assert.strictEqual(r.code, 0);
  assert.ok(/отсутствует/.test(r.out), r.out);
  assert.ok(r.out.includes('.compact-guard.bak'), 'не сказано про резервную копию');
  assert.strictEqual(fs.readFileSync(mdPath(box), 'utf8'), '# Проект\n');
});

// ——— init --apply ———

test('init --apply создаёт CLAUDE.md с блоком', () => {
  const box = sandbox();
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 0);
  const text = fs.readFileSync(mdPath(box), 'utf8');
  assert.ok(text.includes(instructor.CLAUDE_MD_START));
  assert.ok(text.includes(instructor.RULES_TEXT));
  // Файла не было — копия не нужна.
  assert.ok(!fs.existsSync(mdPath(box) + '.compact-guard.bak'));
});

test('init --apply дописывает блок к существующему файлу и делает .bak', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Мой проект\n\nПравила пользователя.\n');
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 0);
  const text = fs.readFileSync(mdPath(box), 'utf8');
  assert.ok(text.includes('Правила пользователя.'), 'текст пользователя потерян');
  assert.ok(text.includes(instructor.CLAUDE_MD_START));
  const bak = fs.readFileSync(mdPath(box) + '.compact-guard.bak', 'utf8');
  assert.strictEqual(bak, '# Мой проект\n\nПравила пользователя.\n');
});

test('повторный init --apply идемпотентен: один блок, файл не растёт', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Проект\n');
  cmd(box, 'init', ['--apply']);
  const first = fs.readFileSync(mdPath(box), 'utf8');
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 0);
  const second = fs.readFileSync(mdPath(box), 'utf8');
  assert.strictEqual(second, first, 'второй apply изменил файл');
  const count = second.split(instructor.CLAUDE_MD_START).length - 1;
  assert.strictEqual(count, 1, 'блок продублирован');
  assert.ok(/уже актуален/.test(r.out));
});

test('init --apply заменяет устаревший текст между маркерами', () => {
  const box = sandbox();
  const stale = instructor.CLAUDE_MD_START + '\n# Compact instructions\nстарый текст\n' + instructor.CLAUDE_MD_END;
  fs.writeFileSync(mdPath(box), '# Проект\n\n' + stale + '\n\nхвост\n');
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 0);
  const text = fs.readFileSync(mdPath(box), 'utf8');
  assert.ok(!text.includes('старый текст'), 'старый текст не заменён');
  assert.ok(text.includes(instructor.RULES_TEXT));
  assert.ok(text.includes('# Проект'), 'текст до блока потерян');
  assert.ok(text.includes('хвост'), 'текст после блока потерян');
  assert.strictEqual(text.split(instructor.CLAUDE_MD_START).length - 1, 1);
});

test('init --preview на устаревшем блоке сообщает про расхождение', () => {
  const box = sandbox();
  const stale = instructor.CLAUDE_MD_START + '\nстарьё\n' + instructor.CLAUDE_MD_END;
  fs.writeFileSync(mdPath(box), stale + '\n');
  const r = cmd(box, 'init', ['--preview']);
  assert.strictEqual(r.code, 0);
  assert.ok(/уже установлен/.test(r.out));
  assert.ok(/устарел/.test(r.out), r.out);
  // Ничего не переписали.
  assert.ok(fs.readFileSync(mdPath(box), 'utf8').includes('старьё'));
});

test('init --preview на актуальном блоке говорит, что менять нечего', () => {
  const box = sandbox();
  cmd(box, 'init', ['--apply']);
  const r = cmd(box, 'init', ['--preview']);
  assert.strictEqual(r.code, 0);
  assert.ok(/совпадает с актуальным/.test(r.out), r.out);
});

// ——— remove-rules ———

test('remove-rules удаляет блок, сохраняет остальное, делает .bak', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Проект\n\nПравила пользователя.\n');
  cmd(box, 'init', ['--apply']);
  const r = cmd(box, 'remove-rules');
  assert.strictEqual(r.code, 0);
  const text = fs.readFileSync(mdPath(box), 'utf8');
  assert.ok(!text.includes(instructor.CLAUDE_MD_START));
  assert.ok(!text.includes(instructor.CLAUDE_MD_END));
  assert.ok(text.includes('Правила пользователя.'));
  // Копия сделана перед удалением — в ней блок ещё есть.
  const bak = fs.readFileSync(mdPath(box) + '.compact-guard.bak', 'utf8');
  assert.ok(bak.includes(instructor.CLAUDE_MD_START));
  // Лишних пустых строк не осталось.
  assert.ok(!/\n\n\n/.test(text), 'лишние пустые строки: ' + JSON.stringify(text));
});

test('remove-rules без блока — говорит об этом, файл не меняет', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Проект\n');
  const r = cmd(box, 'remove-rules');
  assert.strictEqual(r.code, 0);
  assert.ok(/нет блока/.test(r.out));
  assert.strictEqual(fs.readFileSync(mdPath(box), 'utf8'), '# Проект\n');
});

test('remove-rules без файла — говорит, что удалять нечего', () => {
  const box = sandbox();
  const r = cmd(box, 'remove-rules');
  assert.strictEqual(r.code, 0);
  assert.ok(/удалять нечего/.test(r.out));
});

test('remove-rules: файл стал пустым — оставлен, с пояснением', () => {
  const box = sandbox();
  cmd(box, 'init', ['--apply']); // файл создан только из блока
  const r = cmd(box, 'remove-rules');
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(mdPath(box)), 'файл удалён, а удалять его нельзя');
  assert.strictEqual(fs.readFileSync(mdPath(box), 'utf8'), '');
  assert.ok(/пустым/.test(r.out));
});

// ——— mode ———

test('mode без аргумента показывает режим и путь к config.json', () => {
  const box = sandbox();
  const r = cmd(box, 'mode');
  assert.strictEqual(r.code, 0);
  assert.ok(/Режим: lite/.test(r.out));
  assert.ok(r.out.includes(dataPaths(box).config));
});

test('mode strict пишет config.json и печатает обещанную строку', () => {
  const box = sandbox();
  const r = cmd(box, 'mode', ['strict']);
  assert.strictEqual(r.code, 0);
  assert.ok(r.out.includes('Режим: strict. Инспектор-2 будет вызывать `claude -p` после каждой компакции.'), r.out);
  const cfg = JSON.parse(fs.readFileSync(dataPaths(box).config, 'utf8'));
  assert.strictEqual(cfg.mode, 'strict');
  // Показ после записи видит новый режим.
  assert.ok(/Режим: strict/.test(cmd(box, 'mode').out));
});

test('mode lite возвращает режим обратно, не теряя другие настройки', () => {
  const box = sandbox();
  const l = dataPaths(box);
  fs.mkdirSync(l.root, { recursive: true });
  fs.writeFileSync(l.config, JSON.stringify({ mode: 'strict', revisor: { enabled: true, max_retries: 5 }, major_tools: ['Edit'] }));
  const r = cmd(box, 'mode', ['lite']);
  assert.strictEqual(r.code, 0);
  const cfg = JSON.parse(fs.readFileSync(l.config, 'utf8'));
  assert.strictEqual(cfg.mode, 'lite');
  assert.strictEqual(cfg.revisor.max_retries, 5, 'чужие настройки затёрты');
  assert.deepStrictEqual(cfg.major_tools, ['Edit']);
});

test('mode с чужим значением — ошибка, config не создаётся', () => {
  const box = sandbox();
  const r = cmd(box, 'mode', ['paranoid']);
  assert.strictEqual(r.code, 1);
  assert.ok(/lite или strict/.test(r.out));
  assert.ok(!fs.existsSync(dataPaths(box).config));
});

// ——— report ———

test('report без данных — одна фраза и путь, где данные появятся', () => {
  const box = sandbox();
  const r = cmd(box, 'report');
  assert.strictEqual(r.code, 0);
  assert.ok(/Compact Guard ещё ничего не записал для этого проекта/.test(r.out));
  assert.ok(r.out.includes(dataPaths(box).root));
});

test('report с данными: режим, пути, карточки целиком, открытые ошибки, находки', () => {
  const box = sandbox();
  const l = dataPaths(box);
  fs.mkdirSync(l.cards, { recursive: true });
  fs.writeFileSync(l.config, JSON.stringify({ mode: 'strict' }));
  // Две карточки: проверяем, что обе попадают целиком.
  fs.writeFileSync(path.join(l.cards, '2026-09-27T10-00-00Z.md'), '# Записка №1 · 27.09.2026 10:00 · manual\nВердикт: ✅\n');
  fs.writeFileSync(path.join(l.cards, '2026-09-28T10-00-00Z.md'), '# Записка №2 · 28.09.2026 10:00 · auto\nВердикт: ⚠️\n');
  fs.writeFileSync(l.ledger, [
    JSON.stringify({ id: 'e_0001', ts: '2026-09-28T09:00:00Z', session_id: SESSION, tool: 'Bash', kind: 'nonzero_exit', significance: 'major', signature: 'npm test', command: 'npm test', exit_code: 1, detail: 'Exit code 1', count: 2, status: 'open' }),
    JSON.stringify({ id: 'e_0002', ts: '2026-09-28T09:05:00Z', session_id: SESSION, tool: 'Bash', kind: 'nonzero_exit', significance: 'major', signature: 'tsc', command: 'tsc', exit_code: 2, detail: '', count: 1, status: 'open' }),
    JSON.stringify({ id: 'e_0002', kind: 'status', status: 'resolved', ts: '2026-09-28T09:06:00Z' })
  ].join('\n') + '\n');
  fs.writeFileSync(l.findings, [
    JSON.stringify({ ts: new Date().toISOString(), class: 'concealment', source: 'inspector1' }),
    JSON.stringify({ ts: new Date().toISOString(), class: 'missing_disclosure', source: 'inspector2' }),
    // Старая находка за пределами 7 дней в счёт не идёт.
    JSON.stringify({ ts: new Date(Date.now() - 30 * 86400000).toISOString(), class: 'concealment', source: 'inspector1' })
  ].join('\n') + '\n');

  const r = cmd(box, 'report');
  assert.strictEqual(r.code, 0);
  assert.ok(/Режим: strict/.test(r.out));
  assert.ok(r.out.includes(l.root), 'нет пути к каталогу данных');
  assert.ok(r.out.includes(l.config), 'нет пути к config.json');
  // Карточки целиком, новая первой.
  assert.ok(r.out.includes('# Записка №2'), 'нет второй карточки');
  assert.ok(r.out.includes('# Записка №1'), 'нет первой карточки');
  assert.ok(r.out.indexOf('# Записка №2') < r.out.indexOf('# Записка №1'), 'порядок не от новых к старым');
  // Открытые: только e_0001 (e_0002 стала resolved).
  assert.ok(/e_0001/.test(r.out));
  assert.ok(!/- e_0002/.test(r.out), 'исправленная ошибка попала в открытые');
  assert.ok(/npm test/.test(r.out));
  assert.ok(/открыта/.test(r.out));
  assert.ok(/повторов: 2/.test(r.out));
  // Находки: две за 7 дней.
  assert.ok(/за 7 дней: 2/.test(r.out), r.out);
});

test('report по умолчанию показывает 5 карточек, --limit меняет число', () => {
  const box = sandbox();
  const l = dataPaths(box);
  fs.mkdirSync(l.cards, { recursive: true });
  fs.writeFileSync(l.config, JSON.stringify({ mode: 'lite' }));
  for (let i = 1; i <= 7; i++) {
    fs.writeFileSync(path.join(l.cards, '2026-09-0' + i + 'T10-00-00Z.md'), '# Записка №' + i + '\n');
  }
  // Контракт skills/report/SKILL.md: по умолчанию последние 5.
  const def = cmd(box, 'report');
  assert.ok(/\(5 из 7\)/.test(def.out), 'по умолчанию не 5 карточек: ' + def.out.slice(0, 400));
  assert.ok(def.out.includes('# Записка №7'));
  assert.ok(!def.out.includes('# Записка №2'), 'показано больше 5');

  const one = cmd(box, 'report', ['--limit', '1']);
  assert.ok(/\(1 из 7\)/.test(one.out));
  assert.ok(one.out.includes('# Записка №7'));
  assert.ok(!one.out.includes('# Записка №6'));

  const eq = cmd(box, 'report', ['--limit=2']);
  assert.ok(/\(2 из 7\)/.test(eq.out));
});

test('report всегда печатает режим и полный путь к config.json', () => {
  const box = sandbox();
  const l = dataPaths(box);
  fs.mkdirSync(l.root, { recursive: true });
  // Даже когда config.json отсутствует, путь и режим по умолчанию в отчёте есть.
  fs.writeFileSync(l.ledger, '');
  const noCfg = cmd(box, 'report');
  assert.strictEqual(noCfg.code, 0);
  assert.ok(/Режим: lite/.test(noCfg.out), noCfg.out);
  assert.ok(noCfg.out.includes(l.config), 'нет полного пути к config.json');
  assert.ok(path.isAbsolute(l.config));

  fs.writeFileSync(l.config, JSON.stringify({ mode: 'strict' }));
  const withCfg = cmd(box, 'report');
  assert.ok(/Режим: strict/.test(withCfg.out));
  assert.ok(withCfg.out.includes(l.config));
});

test('report: есть журнал, но компакций не было', () => {
  const box = sandbox();
  const l = dataPaths(box);
  fs.mkdirSync(l.root, { recursive: true });
  fs.writeFileSync(l.config, JSON.stringify({ mode: 'lite' }));
  const r = cmd(box, 'report');
  assert.strictEqual(r.code, 0);
  assert.ok(/Компакций в этом проекте ещё не было/.test(r.out));
  assert.ok(/Открытых ошибок нет/.test(r.out));
});

// ——— общее ———

test('неизвестная подкоманда — exit 1 и список доступных', () => {
  const box = sandbox();
  const r = cmd(box, 'no-such-thing');
  assert.strictEqual(r.code, 1);
  assert.ok(/report/.test(r.out) && /init/.test(r.out) &&
    /remove-rules/.test(r.out) && /mode/.test(r.out), r.out);
});

// Ни одна cmd:*, включая неизвестную, не должна ждать stdin: скилл запускает её без входа.
// Живой пайп без писателя: если бы обработчик читал stdin, тест упал бы по таймауту.
function cmdOpenStdin(box, name, args) {
  const res = spawnSync(process.execPath, [HOOK, 'cmd:' + name].concat(args || []), {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: box.data, CLAUDE_PROJECT_DIR: box.proj }),
    timeout: 6000
  });
  assert.ok(!res.error || res.error.code !== 'ETIMEDOUT',
    'cmd:' + name + ' ждал stdin и завис');
  return { code: res.status, out: res.stdout || '' };
}

test('cmd:xyz не читает stdin: печатает список команд и выходит с кодом 1', () => {
  const box = sandbox();
  const r = cmdOpenStdin(box, 'xyz');
  assert.strictEqual(r.code, 1);
  assert.ok(/report/.test(r.out) && /init/.test(r.out) &&
    /remove-rules/.test(r.out) && /mode/.test(r.out), r.out);
});

test('известные cmd:* не читают stdin', () => {
  const box = sandbox();
  assert.strictEqual(cmdOpenStdin(box, 'mode').code, 0);
  assert.strictEqual(cmdOpenStdin(box, 'report').code, 0);
  assert.strictEqual(cmdOpenStdin(box, 'init', ['--preview']).code, 0);
  assert.strictEqual(cmdOpenStdin(box, 'remove-rules').code, 0);
});

test('без CLAUDE_PROJECT_DIR берётся cwd', () => {
  const box = sandbox();
  const env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: box.data });
  delete env.CLAUDE_PROJECT_DIR;
  const res = spawnSync(process.execPath, [HOOK, 'cmd:init', '--show'], {
    encoding: 'utf8', cwd: box.proj, env, timeout: 20000
  });
  assert.strictEqual(res.status, 0);
  assert.ok((res.stdout || '').includes(path.join(fs.realpathSync(box.proj), 'CLAUDE.md')) ||
    (res.stdout || '').includes(path.join(box.proj, 'CLAUDE.md')), res.stdout);
});

// ——— дефект 9 verify-v1: .bak при первом применении к существующему файлу ———

test('init --apply к существующему файлу всегда делает .bak', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Мой проект\n\nПравила пользователя.\n');
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const bak = mdPath(box) + '.compact-guard.bak';
  assert.ok(fs.existsSync(bak), 'резервная копия не создана: ' + r.out);
  assert.strictEqual(fs.readFileSync(bak, 'utf8'), '# Мой проект\n\nПравила пользователя.\n');
  assert.ok(r.out.includes('Резервная копия'), r.out);
});

test('init --apply на уже актуальном блоке всё равно оставляет .bak', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Мой проект\n');
  cmd(box, 'init', ['--apply']);
  const bak = mdPath(box) + '.compact-guard.bak';
  const first = fs.readFileSync(bak, 'utf8');
  const r = cmd(box, 'init', ['--apply']);
  assert.ok(r.out.includes('уже актуален'), r.out);
  assert.ok(fs.existsSync(bak), 'копия исчезла при повторном apply');
  // Вторая копия снята с файла, уже содержащего блок.
  assert.notStrictEqual(fs.readFileSync(bak, 'utf8'), first);
});

// ——— HIGH-4 security-v1: запись сквозь символическую ссылку ———

test('HIGH-4: init --apply отказывается писать сквозь симлинк CLAUDE.md', () => {
  const box = sandbox();
  const outside = path.join(box.proj, 'OUTSIDE.md');
  fs.writeFileSync(outside, 'чужой файл\n');
  fs.symlinkSync(outside, mdPath(box));

  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 1, 'ожидался отказ, получено: ' + r.out);
  assert.match(r.out, /символическая ссылка/i, r.out);
  // Цель не тронута, блок в неё не дописан.
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'чужой файл\n');
  assert.ok(!fs.existsSync(mdPath(box) + '.compact-guard.bak'), 'создан .bak с чужим содержимым');
  // Симлинк остался симлинком.
  assert.ok(fs.lstatSync(mdPath(box)).isSymbolicLink());
});

test('HIGH-4: remove-rules тоже отказывается работать через симлинк', () => {
  const box = sandbox();
  const outside = path.join(box.proj, 'OUTSIDE.md');
  fs.writeFileSync(outside, instructor.claudeMdBlock() + '\n');
  fs.symlinkSync(outside, mdPath(box));

  const r = cmd(box, 'remove-rules', []);
  assert.strictEqual(r.code, 1, 'ожидался отказ, получено: ' + r.out);
  assert.match(r.out, /символическая ссылка/i, r.out);
  assert.ok(fs.readFileSync(outside, 'utf8').includes(instructor.CLAUDE_MD_START),
    'блок удалён из целевого файла');
});

// ——— MED-1 security-v1: несколько блоков в CLAUDE.md ———

const DOUBLE_MARKERS = [
  'user top',
  instructor.CLAUDE_MD_START,
  'user text A',
  instructor.CLAUDE_MD_START,
  'user text B',
  instructor.CLAUDE_MD_END,
  'user text C',
  instructor.CLAUDE_MD_END,
  'user bottom',
  ''
].join('\n');

test('MED-1: remove-rules отказывается при нескольких блоках, текст не теряется', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), DOUBLE_MARKERS);
  const r = cmd(box, 'remove-rules', []);
  assert.strictEqual(r.code, 1, 'ожидался отказ, получено: ' + r.out);
  assert.match(r.out, /несколько блоков Compact Guard/i, r.out);
  // Файл не изменён вообще.
  assert.strictEqual(fs.readFileSync(mdPath(box), 'utf8'), DOUBLE_MARKERS);
  assert.ok(fs.readFileSync(mdPath(box), 'utf8').includes('user text A'));
  assert.ok(fs.readFileSync(mdPath(box), 'utf8').includes('user text B'));
});

test('MED-1: init --apply отказывается при нескольких блоках', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), DOUBLE_MARKERS);
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 1, 'ожидался отказ, получено: ' + r.out);
  assert.match(r.out, /несколько блоков Compact Guard/i, r.out);
  assert.strictEqual(fs.readFileSync(mdPath(box), 'utf8'), DOUBLE_MARKERS);
  assert.ok(!fs.existsSync(mdPath(box) + '.compact-guard.bak'));
});

test('MED-1: осиротевший маркер без пары — тоже отказ', () => {
  const box = sandbox();
  const text = 'user top\n' + instructor.CLAUDE_MD_END + '\nuser bottom\n';
  fs.writeFileSync(mdPath(box), text);
  const r = cmd(box, 'init', ['--apply']);
  assert.strictEqual(r.code, 1, r.out);
  assert.strictEqual(fs.readFileSync(mdPath(box), 'utf8'), text);
});

test('MED-1: одна нормальная пара маркеров по-прежнему обрабатывается', () => {
  const box = sandbox();
  fs.writeFileSync(mdPath(box), '# Проект\n');
  assert.strictEqual(cmd(box, 'init', ['--apply']).code, 0);
  const r = cmd(box, 'remove-rules', []);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(!fs.readFileSync(mdPath(box), 'utf8').includes(instructor.CLAUDE_MD_START));
});

// Скиллы передают каталог данных явно: --data "${CLAUDE_PLUGIN_DATA}" (переменная в
// окружение Bash не экспортируется — живая проверка 28.09.2026).
test('--data задаёт каталог данных без переменной окружения; относительный путь игнорируется', () => {
  const box = sandbox();
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: box.proj });
  delete env.CLAUDE_PLUGIN_DATA;
  const run = (args) => spawnSync(process.execPath, [HOOK, 'cmd:mode'].concat(args), { encoding: 'utf8', env, timeout: 20000 });
  const r1 = run(['strict', '--data', box.data]);
  assert.strictEqual(r1.status, 0, r1.stderr);
  const cfg = path.join(box.data, 'projects', require('../scripts/lib/paths').projectSlug(box.proj), 'config.json');
  assert.ok(fs.existsSync(cfg), 'config.json должен появиться в каталоге из --data');
  assert.strictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).mode, 'strict');
  const r2 = run(['--data=' + box.data]);
  assert.match(r2.stdout, /strict/);
  const r3 = run(['--data', 'relative/dir']);
  assert.strictEqual(r3.status, 0);
  assert.ok(!fs.existsSync(path.join(box.proj, 'relative')), 'относительный --data не должен создавать каталог');
});
