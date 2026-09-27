'use strict';
// Каталог данных проекта. По плану §0: ${CLAUDE_PLUGIN_DATA}/projects/<slug>/,
// fallback ~/.claude/compact-guard/projects/<slug>/.
// slug = имя папки проекта + короткий хэш полного пути (чтобы одноимённые проекты не смешивались).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function projectSlug(cwd) {
  const abs = path.resolve(cwd || process.cwd());
  const base = path.basename(abs) || 'project';
  const safe = base.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const hash = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 8);
  return safe.slice(0, 40) + '-' + hash;
}

function dataRoot() {
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return path.join(os.homedir(), '.claude', 'compact-guard');
}

function projectDir(cwd) {
  return path.join(dataRoot(), 'projects', projectSlug(cwd));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Все пути, которыми пользуются обработчики.
function layout(cwd) {
  const root = projectDir(cwd);
  return {
    root,
    config: path.join(root, 'config.json'),
    state: path.join(root, 'state.json'),
    ledger: path.join(root, 'ledger.jsonl'),
    events: path.join(root, 'events.jsonl'),
    findings: path.join(root, 'findings.jsonl'),
    notices: path.join(root, 'notices.jsonl'),
    summaries: path.join(root, 'summaries'),
    cards: path.join(root, 'cards'),
    sessions: path.join(root, 'sessions')
  };
}

module.exports = { projectSlug, dataRoot, projectDir, ensureDir, layout };
