'use strict';
// Каталог данных проекта и slug (план §0, §1). Главное требование: один проект —
// один slug, как бы к нему ни пришли (симлинк, относительный путь, лишние слэши).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paths = require('../scripts/lib/paths');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'cg-paths-'));
}

test('slug = имя папки + 8 hex от пути', () => {
  const dir = tmp();
  const slug = paths.projectSlug(dir);
  assert.match(slug, /-[0-9a-f]{8}$/, slug);
  assert.ok(slug.startsWith(path.basename(fs.realpathSync(dir))), slug);
});

test('один и тот же путь даёт один и тот же slug', () => {
  const dir = tmp();
  assert.strictEqual(paths.projectSlug(dir), paths.projectSlug(dir));
});

test('разные проекты с одинаковым именем не смешиваются', () => {
  const a = path.join(tmp(), 'myproject');
  const b = path.join(tmp(), 'myproject');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const sa = paths.projectSlug(a);
  const sb = paths.projectSlug(b);
  assert.ok(sa.startsWith('myproject-'));
  assert.ok(sb.startsWith('myproject-'));
  assert.notStrictEqual(sa, sb, 'одноимённые проекты получили один slug');
});

// Живая проверка 28.09.2026: на macOS $TMPDIR это /var/folders/… (симлинк на
// /private/var/folders/…). Сессия Claude Code передаёт в хук realpath, а подкоманда,
// запущенная из симлинк-пути, считала slug от него — получались два каталога данных,
// и `cmd:mode strict` применялся не к тому.
test('симлинк и настоящий путь дают один slug', () => {
  const base = tmp();
  const real = path.join(base, 'real-project');
  fs.mkdirSync(real);
  const link = path.join(base, 'link-to-project');
  fs.symlinkSync(real, link, 'dir');

  assert.strictEqual(
    paths.projectSlug(link),
    paths.projectSlug(real),
    'симлинк дал другой slug: ' + paths.projectSlug(link) + ' vs ' + paths.projectSlug(real)
  );
  // Имя в slug — от настоящего каталога, а не от симлинка.
  assert.ok(paths.projectSlug(link).startsWith('real-project-'), paths.projectSlug(link));
});

test('симлинк на родителя тоже нормализуется', () => {
  const base = tmp();
  const realParent = path.join(base, 'parent');
  fs.mkdirSync(path.join(realParent, 'proj'), { recursive: true });
  const linkParent = path.join(base, 'parent-link');
  fs.symlinkSync(realParent, linkParent, 'dir');

  assert.strictEqual(
    paths.projectSlug(path.join(linkParent, 'proj')),
    paths.projectSlug(path.join(realParent, 'proj'))
  );
});

test('каталог данных проекта одинаков для симлинка и настоящего пути', () => {
  const base = tmp();
  const real = path.join(base, 'p');
  fs.mkdirSync(real);
  const link = path.join(base, 'p-link');
  fs.symlinkSync(real, link, 'dir');
  assert.strictEqual(paths.projectDir(link), paths.projectDir(real));
  assert.strictEqual(paths.layout(link).ledger, paths.layout(real).ledger);
});

test('относительный путь и лишние слэши не меняют slug', () => {
  const dir = fs.realpathSync(tmp());
  const messy = dir + path.sep + '.' + path.sep;
  assert.strictEqual(paths.projectSlug(messy), paths.projectSlug(dir));
});

test('несуществующий путь не роняет slug', () => {
  const missing = path.join(os.tmpdir(), 'cg-no-such-dir-' + Date.now(), 'nested');
  const slug = paths.projectSlug(missing);
  assert.match(slug, /-[0-9a-f]{8}$/, slug);
  assert.ok(slug.startsWith('nested-'), slug);
});

test('небезопасные символы в имени заменяются', () => {
  const base = tmp();
  const weird = path.join(base, 'про ект@#$');
  fs.mkdirSync(weird);
  const slug = paths.projectSlug(weird);
  assert.match(slug, /^[A-Za-z0-9_.-]+$/, slug);
});

test('layout кладёт всё внутрь каталога проекта', () => {
  const dir = tmp();
  const l = paths.layout(dir);
  for (const key of ['config', 'state', 'ledger', 'events', 'findings', 'notices',
    'summaries', 'cards', 'sessions']) {
    assert.ok(l[key].startsWith(l.root + path.sep), key + ' вне каталога проекта: ' + l[key]);
  }
});

test('CLAUDE_PLUGIN_DATA задаёт корень, иначе ~/.claude/compact-guard', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  try {
    const custom = tmp('cg-root-');
    process.env.CLAUDE_PLUGIN_DATA = custom;
    assert.ok(paths.dataRoot().startsWith(custom));
    delete process.env.CLAUDE_PLUGIN_DATA;
    assert.strictEqual(paths.dataRoot(), path.join(os.homedir(), '.claude', 'compact-guard'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = saved;
  }
});
