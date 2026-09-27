'use strict';
// Подкоманды для скиллов: `node cg-hook.js cmd:<name> [args]`. stdin не читается.
// Вывод — обычный текст на русском в stdout, exit 0; ошибка — понятный текст, exit 1.
// Ссылки на файлы всегда абсолютные (скилл показывает их человеку).
//
// Каталог проекта: CLAUDE_PROJECT_DIR, иначе process.cwd().

const fs = require('fs');
const path = require('path');

const { layout, ensureDir } = require('./paths');
const config = require('./config');
const ledger = require('./ledger');
const instructor = require('./instructor');

const BAK_SUFFIX = '.compact-guard.bak';

function projectDir() {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.resolve(process.cwd());
}

function claudeMdPath(dir) {
  return path.join(dir, 'CLAUDE.md');
}

// ——— мелкие помощники ———

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function humanTs(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return String(iso || '—');
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function statusRu(status) {
  if (status === 'resolved') return 'исправлено';
  if (status === 'acknowledged') return 'раскрыто';
  return 'открыта';
}

// Аргументы вида --limit N / --limit=N.
function argValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--' + name) return args[i + 1];
    if (a.startsWith('--' + name + '=')) return a.slice(name.length + 3);
  }
  return undefined;
}

function hasFlag(args, name) {
  return args.indexOf('--' + name) !== -1;
}

// Блок CLAUDE.md: текст между маркерами (без самих маркеров) и его границы в файле.
function findBlock(text) {
  const s = instructor.CLAUDE_MD_START;
  const e = instructor.CLAUDE_MD_END;
  const i = text.indexOf(s);
  if (i === -1) return null;
  const j = text.indexOf(e, i + s.length);
  if (j === -1) return null;
  return {
    start: i,
    end: j + e.length,
    inner: text.slice(i + s.length, j),
    whole: text.slice(i, j + e.length)
  };
}

function backup(file) {
  const bak = file + BAK_SUFFIX;
  fs.copyFileSync(file, bak);
  return bak;
}

// ——— cmd:report ———

function cmdReport(args) {
  const dir = projectDir();
  const l = layout(dir);
  const limitRaw = Number(argValue(args, 'limit'));
  // По умолчанию последние 5 карточек (контракт skills/report/SKILL.md).
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 5;

  const out = [];
  const exists = fs.existsSync(l.root);
  const anyData = exists && ['ledger.jsonl', 'events.jsonl', 'config.json'].some((f) => fs.existsSync(path.join(l.root, f)));

  if (!anyData) {
    out.push('Compact Guard ещё ничего не записал для этого проекта.');
    out.push('Данные появятся здесь: ' + l.root);
    return out.join('\n');
  }

  const cfg = config.load(dir);
  out.push('Compact Guard · отчёт по проекту ' + dir);
  out.push('');
  out.push('Режим: ' + cfg.mode + (cfg.mode === 'strict' ? ' (Инспектор-2 включён)' : ' (Инспектор-2 выключен)'));
  out.push('Каталог данных: ' + l.root);
  out.push('Настройки: ' + l.config + (fs.existsSync(l.config) ? '' : ' (файла нет, действуют значения по умолчанию)'));
  out.push('');

  // Последние N карточек компакции — целиком, как их читает человек.
  let cardFiles = [];
  try {
    cardFiles = fs.readdirSync(l.cards).filter((f) => f.endsWith('.md')).sort();
  } catch (_) { cardFiles = []; }
  const lastCards = cardFiles.slice(-limit).reverse();

  out.push('## Последние карточки компакции (' + lastCards.length + ' из ' + cardFiles.length + ')');
  if (!lastCards.length) {
    out.push('Компакций в этом проекте ещё не было.');
  } else {
    for (const name of lastCards) {
      const full = path.join(l.cards, name);
      out.push('');
      out.push('— ' + full);
      let body = '';
      try { body = fs.readFileSync(full, 'utf8'); } catch (e) { body = '(файл не читается: ' + String(e && e.message) + ')'; }
      out.push(body.replace(/\s+$/, ''));
    }
  }
  out.push('');

  // Открытые ошибки проекта (все сессии): id, сигнатура, когда, статус.
  const openRows = ledger.readMerged(dir).filter((r) => r.kind !== 'compaction' && r.status === 'open');
  out.push('## Открытые ошибки (' + openRows.length + ')');
  if (!openRows.length) {
    out.push('Открытых ошибок нет.');
  } else {
    for (const r of openRows) {
      out.push('- ' + r.id + ' · ' + (r.signature || r.command || r.kind) +
        ' · ' + humanTs(r.last_ts || r.ts) + ' · ' + statusRu(r.status) +
        (r.count > 1 ? ' · повторов: ' + r.count : ''));
    }
  }
  out.push('');

  // Находки за 7 дней.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const findings = readJsonl(l.findings).filter((f) => {
    const t = Date.parse(f.ts || '');
    return Number.isFinite(t) ? t >= cutoff : true;
  });
  out.push('## Находки Инспектора за 7 дней: ' + findings.length);
  if (findings.length) {
    const byClass = {};
    for (const f of findings) byClass[f.class || 'unknown'] = (byClass[f.class || 'unknown'] || 0) + 1;
    out.push('По классам: ' + Object.keys(byClass).map((k) => k + ' — ' + byClass[k]).join(', ') + '.');
    out.push('Подробности: ' + l.findings);
  }

  return out.join('\n');
}

// ——— cmd:init ———

function cmdInit(args) {
  // --preview — основной флаг предпросмотра (контракт skills/init/SKILL.md),
  // --show оставлен синонимом. Без флагов ведём себя как --preview: ничего не пишем.
  const apply = hasFlag(args, 'apply');

  const dir = projectDir();
  const file = claudeMdPath(dir);
  const block = instructor.claudeMdBlock();
  const out = [];

  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { text = null; }
  const found = text == null ? null : findBlock(text);

  if (!apply) {
    // Предпросмотр: на диске не меняется ничего.
    out.push('Файл правил проекта: ' + file);
    out.push(text == null
      ? 'Файла нет — при --apply он будет создан.'
      : 'Файл есть — при --apply он будет дописан или обновлён, рядом появится ' + file + BAK_SUFFIX + '.');
    out.push('');
    if (!found) {
      out.push('Блок Compact Guard в файле отсутствует.');
    } else if (found.whole.trim() === block.trim()) {
      out.push('Блок Compact Guard уже установлен, текст совпадает с актуальным — менять нечего.');
    } else {
      out.push('Блок Compact Guard уже установлен, но текст устарел: --apply заменит содержимое между маркерами.');
    }
    out.push('');
    out.push('Блок, который добавит --apply:');
    out.push('');
    out.push(block);
    return out.join('\n');
  }

  // --apply
  if (text == null) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, block + '\n', 'utf8');
    out.push('Создан ' + file + ' с блоком Compact Guard.');
    out.push('Резервная копия не нужна: файла раньше не было.');
    return out.join('\n');
  }

  const bak = backup(file);
  if (found) {
    if (found.whole.trim() === block.trim()) {
      out.push('Блок Compact Guard в ' + file + ' уже актуален — файл не изменён.');
      out.push('Резервная копия: ' + bak);
      return out.join('\n');
    }
    const next = text.slice(0, found.start) + block + text.slice(found.end);
    fs.writeFileSync(file, next, 'utf8');
    out.push('Блок Compact Guard в ' + file + ' обновлён (заменено содержимое между маркерами).');
    out.push('Резервная копия: ' + bak);
    return out.join('\n');
  }

  const sep = text.length && !/\n$/.test(text) ? '\n\n' : (text.length ? '\n' : '');
  fs.writeFileSync(file, text + sep + block + '\n', 'utf8');
  out.push('Блок Compact Guard добавлен в конец ' + file + '.');
  out.push('Резервная копия: ' + bak);
  return out.join('\n');
}

// ——— cmd:remove-rules ———

function cmdRemoveRules() {
  const dir = projectDir();
  const file = claudeMdPath(dir);
  const out = [];

  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { text = null; }
  if (text == null) {
    out.push('Файла ' + file + ' нет — удалять нечего.');
    return out.join('\n');
  }

  const found = findBlock(text);
  if (!found) {
    out.push('В ' + file + ' нет блока Compact Guard (маркеров ' + instructor.CLAUDE_MD_START + ' … ' +
      instructor.CLAUDE_MD_END + ') — файл не изменён.');
    return out.join('\n');
  }

  const bak = backup(file);
  // Снимаем блок и по одному пустому переводу строки с каждой стороны.
  let before = text.slice(0, found.start).replace(/\n[ \t]*\n$/, '\n');
  let after = text.slice(found.end).replace(/^\n[ \t]*\n/, '\n');
  // Если блок был последним, лишний перевод строки в начале хвоста не нужен.
  if (!after.trim()) after = '';
  let next = before + after;
  if (!next.trim()) next = '';

  fs.writeFileSync(file, next, 'utf8');
  out.push('Блок Compact Guard удалён из ' + file + '.');
  out.push('Резервная копия: ' + bak);
  if (next === '') {
    // Файл мог существовать до плагина — удалять его мы не вправе.
    out.push('Файл стал пустым, но оставлен на месте: неизвестно, создавал ли его Compact Guard. ' +
      'Если он вам не нужен, удалите его сами.');
  }
  return out.join('\n');
}

// ——— cmd:mode ———

function cmdMode(args) {
  const dir = projectDir();
  const l = layout(dir);
  const wanted = args.filter((a) => !a.startsWith('-'))[0];
  const out = [];

  if (!wanted) {
    const cfg = config.load(dir);
    out.push('Режим: ' + cfg.mode + '.');
    out.push(cfg.mode === 'strict'
      ? 'Инспектор-2 вызывает `claude -p` после каждой компакции.'
      : 'Инспектор-2 выключен; Ревизор требует только значимые неисправленные ошибки.');
    out.push('Настройки: ' + l.config + (fs.existsSync(l.config) ? '' : ' (файла нет, действуют значения по умолчанию)'));
    return out.join('\n');
  }

  if (wanted !== 'lite' && wanted !== 'strict') {
    throw new Error('режим бывает только lite или strict, получено: ' + wanted);
  }

  ensureDir(l.root);
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(l.config, 'utf8')) || {}; } catch (_) { cur = {}; }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
  if (!cur.revisor || typeof cur.revisor !== 'object') cur.revisor = { enabled: true, max_retries: 2 };
  cur.mode = wanted;
  const tmp = l.config + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n');
  fs.renameSync(tmp, l.config);

  if (wanted === 'strict') {
    out.push('Режим: strict. Инспектор-2 будет вызывать `claude -p` после каждой компакции.');
  } else {
    out.push('Режим: lite. Инспектор-2 выключен, Ревизор требует только значимые неисправленные ошибки.');
  }
  out.push('Записано в ' + l.config);
  return out.join('\n');
}

// ——— диспетчер ———

const COMMANDS = {
  report: cmdReport,
  init: cmdInit,
  'remove-rules': cmdRemoveRules,
  mode: cmdMode
};

// Возвращает {code, text}. Никогда не бросает.
function run(name, args) {
  const fn = COMMANDS[name];
  if (!fn) {
    return {
      code: 1,
      text: 'Compact Guard: неизвестная подкоманда «' + name + '». Есть: ' + Object.keys(COMMANDS).join(', ') + '.'
    };
  }
  try {
    return { code: 0, text: fn(args || []) };
  } catch (e) {
    return { code: 1, text: 'Compact Guard: ' + String((e && e.message) || e) };
  }
}

module.exports = { run, COMMANDS, projectDir, claudeMdPath, findBlock, BAK_SUFFIX };
