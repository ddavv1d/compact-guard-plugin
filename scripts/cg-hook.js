#!/usr/bin/env node
'use strict';
// Compact Guard — единая точка входа для всех хуков.
// Использование: node cg-hook.js <Event>   (вход — JSON на stdin)
//
// Правило, которое важнее всего (план §2, ТЗ §5): всё, кроме Ревизора, fail-open.
// Любая внутренняя ошибка → строка в events.jsonl, exit 0, пустой stdout.
// Ревизор при внутренней ошибке тоже exit 0: блокировать по своей вине нельзя.

const path = require('path');

const config = require('./lib/config');
const events = require('./lib/events');
const ledger = require('./lib/ledger');
const classify = require('./lib/classify');
const transcript = require('./lib/transcript');
const inspector = require('./lib/inspector');
const instructor = require('./lib/instructor');
const revisor = require('./lib/revisor');
const notices = require('./lib/notices');
const { layout, ensureDir } = require('./lib/paths');
const fs = require('fs');

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(raw));
  });
}

function emit(obj) {
  if (!obj) return;
  process.stdout.write(JSON.stringify(obj));
}

function ctxOut(eventName, text) {
  if (!text) return null;
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext: text } };
}

// ——— состояние сессии для Ревизора (счётчик попыток) ———

function sessionStatePath(cwd, sessionId) {
  const dir = layout(cwd).sessions;
  ensureDir(dir);
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '-');
  return path.join(dir, safe + '.json');
}

function readSessionState(cwd, sessionId) {
  try {
    const s = JSON.parse(fs.readFileSync(sessionStatePath(cwd, sessionId), 'utf8'));
    if (s && typeof s === 'object') return s;
  } catch (_) { /* нет файла */ }
  return { attempts: 0, prompt_id: null };
}

function writeSessionState(cwd, sessionId, state) {
  const p = sessionStatePath(cwd, sessionId);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// ——— обработчики ———

function onSessionStart(cwd, input, cfg) {
  const source = input.source || 'startup';
  const parts = [instructor.rules()];

  if (source === 'startup') {
    try { config.ensureDefaultFile(cwd); } catch (_) { /* не критично */ }
    try { ledger.rotate(cwd, cfg, input.session_id); } catch (_) { /* не критично */ }
  }

  let note = 'instructor';

  if (source === 'compact') {
    const sessionRows = ledger.forSession(cwd, input.session_id);
    const openRows = sessionRows.filter((r) => r.kind !== 'compaction' && r.status === 'open');
    // Ожидание сброса транскрипта на диск; в тестах и doctor сокращается через env.
    const waitMs = Number(process.env.CG_TRANSCRIPT_WAIT_MS);
    const found = transcript.lastSummary(input.transcript_path, Number.isFinite(waitMs) ? waitMs : 150);

    if (found && found.text) {
      const res = inspector.inspect(cwd, {
        summary: found.text,
        sessionRows,
        session_id: input.session_id,
        trigger: found.trigger || input.trigger || 'unknown',
        archiveSuffix: 'clean'
      });
      const fc = inspector.findingContext(res.findings, res.openMajor);
      if (fc) parts.push(fc);
      note = 'inspector1:' + (res.findings.length ? 'findings=' + res.findings.length : 'clean');
    } else {
      // Резюме не нашлось — предупреждение в events, вердикт отложен (план §2).
      events.record(cwd, {
        event: 'SessionStart',
        source,
        session_id: input.session_id,
        result: 'summary_not_found',
        transcript_path: input.transcript_path || null
      });
      note = 'inspector1:summary_not_found';
    }

    // Всегда: открытые ошибки ledger в additionalContext (план §0 строка 13).
    const openText = instructor.openErrorsText(openRows, ledger.describe);
    if (openText) parts.push(openText);
  }

  // Непустая очередь доставляется и здесь — чтобы отложенный вердикт не потерялся.
  try {
    const q = notices.drain(cwd, input.session_id);
    if (q.text) parts.push(q.text);
  } catch (_) { /* очередь не критична */ }

  emit(ctxOut('SessionStart', parts.join('\n')));
  return note;
}

function onPostCompact(cwd, input, cfg) {
  const trigger = input.trigger || 'unknown';
  ledger.recordCompaction(cwd, { session_id: input.session_id, trigger });

  let archived = null;
  const raw = typeof input.compact_summary === 'string' ? input.compact_summary : '';
  if (raw.trim()) {
    try { archived = inspector.archiveSummary(cwd, raw, 'raw', new Date()); } catch (_) { archived = null; }
  }

  // Если Инспектор-1 не нашёл резюме в транскрипте (SessionStart:compact шёл раньше),
  // страхуемся: проверяем сырое резюме здесь и кладём вердикт в очередь.
  let note = 'compaction:' + trigger + (archived ? ':archived' : ':no_summary');
  if (raw.trim()) {
    const events1 = events.readAll(cwd);
    const missed = events1.some(
      (e) => e.event === 'SessionStart' && e.session_id === input.session_id && e.result === 'summary_not_found'
    );
    if (missed) {
      const sessionRows = ledger.forSession(cwd, input.session_id);
      const res = inspector.inspect(cwd, {
        summary: transcript.stripAnalysis(raw) || raw,
        sessionRows,
        session_id: input.session_id,
        trigger,
        archiveSuffix: 'clean-from-postcompact'
      });
      const fc = inspector.findingContext(res.findings, res.openMajor);
      if (fc) {
        notices.push(cwd, { session_id: input.session_id, source: 'inspector1_late', text: fc });
        note += ':queued_finding';
      }
    }
  }

  if (cfg.mode === 'strict' && cfg.inspector2 && cfg.inspector2.enabled !== false) {
    try {
      const i2 = require('./lib/inspector2');
      // Резюме отдаём очищенным от <analysis>…</analysis> — модель проверяет то же,
      // что увидит агент, а не служебные размышления генератора резюме.
      const openRows = ledger.forSession(cwd, input.session_id)
        .filter((r) => r.kind !== 'compaction' && r.status === 'open')
        .map((r) => ledger.describe(r));
      const verdict = i2.review({
        summary: transcript.stripAnalysis(raw) || raw,
        openRows,
        cfg
      });
      const findings = (verdict && Array.isArray(verdict.findings)) ? verdict.findings : [];

      // Каждый вызов виден в events.jsonl: вердикт, длительность, модель, причина отказа.
      events.record(cwd, {
        event: 'PostCompact',
        session_id: input.session_id,
        result: 'inspector2_' + ((verdict && verdict.verdict) || 'none'),
        verdict: (verdict && verdict.verdict) || null,
        findings: findings.length,
        model: (verdict && verdict.model) || null,
        reason: (verdict && verdict.reason) || null,
        inspector2_ms: (verdict && verdict.ms) || null
      });

      if (findings.length) {
        for (const f of findings) {
          inspector.appendFinding(cwd, {
            session_id: input.session_id,
            source: 'inspector2',
            class: f.class,
            quote: f.quote
          });
        }
        notices.push(cwd, {
          session_id: input.session_id,
          source: 'inspector2',
          text: 'Compact Guard, вторая проверка резюме: ' +
            findings.map((f) => f.class + ' — «' + String(f.quote || '').slice(0, 200) + '»').join('; ') + '.'
        });
        note += ':inspector2_findings=' + findings.length;
      } else {
        note += ':inspector2_' + ((verdict && verdict.verdict) || 'none');
      }
    } catch (e) {
      // Fail-open: Инспектор-2 никогда не ломает сессию.
      events.record(cwd, {
        event: 'PostCompact',
        session_id: input.session_id,
        result: 'inspector2_error',
        reason: String((e && e.message) || e)
      });
      note += ':inspector2_error';
    }
  }
  return note;
}

function onPostToolUseFailure(cwd, input, cfg) {
  // Прерывание пользователем — не ошибка агента (план §2).
  if (input.is_interrupt === true) return 'skipped:interrupt';

  const tool = input.tool_name || 'unknown';
  const isShell = tool === 'Bash' || tool === 'PowerShell';
  const errorText = typeof input.error === 'string' ? input.error : JSON.stringify(input.error || '');

  if (isShell) {
    const command = (input.tool_input && input.tool_input.command) || '';
    const exitCode = classify.parseExitCode(errorText);
    const significance = classify.commandSignificance(command, cfg);
    const res = ledger.recordError(cwd, {
      session_id: input.session_id,
      tool,
      kind: 'nonzero_exit',
      significance,
      signature: classify.signature(command),
      command,
      exit_code: exitCode,
      detail: errorText
    });
    return (res.deduped ? 'dedup:' : 'new:') + res.id + ':' + significance;
  }

  const res = ledger.recordError(cwd, {
    session_id: input.session_id,
    tool,
    kind: 'tool_error',
    significance: classify.toolSignificance(tool, cfg),
    signature: tool + ': ' + String(errorText).split('\n')[0].slice(0, 120),
    command: null,
    exit_code: null,
    detail: errorText
  });
  return (res.deduped ? 'dedup:' : 'new:') + res.id;
}

function onPostToolUse(cwd, input, cfg) {
  const tool = input.tool_name || '';
  if (tool !== 'Bash' && tool !== 'PowerShell') return 'skipped:other_tool';
  const command = (input.tool_input && input.tool_input.command) || '';
  const sig = classify.signature(command);
  const notes = [];

  const resp = input.tool_response || {};
  const stdout = [resp.stdout, resp.stderr].filter((s) => typeof s === 'string').join('\n');
  const significance = classify.commandSignificance(command, cfg);

  // 1) Провал в выводе команды, которую Claude Code счёл успешной.
  //    Живая проверка 27.09.2026: тот же упавший `npm test` в одной сессии приходит как
  //    PostToolUseFailure, а в другой — как PostToolUse с is_error=false. Поэтому вывод
  //    значимой команды проверяется всегда, а не только при замаскированном коде выхода.
  let failureHit = null;
  if (significance === 'major') {
    failureHit = classify.looksLikeFailure(stdout, cfg);
  }

  // 2) Закрытие открытой записи с той же сигнатурой — только если вывод чистый.
  //    Иначе повторный прогон с теми же ошибками закрыл бы запись без починки.
  if (!failureHit) {
    const resolved = ledger.resolveBySignature(cwd, input.session_id, sig, tool);
    if (resolved.length) notes.push('resolved:' + resolved.join(','));
    return notes.length ? notes.join(' ') : 'noop';
  }

  const kind = classify.looksLikeTestFailure(stdout, cfg) ? 'test_failure' : 'nonzero_exit';
  const res = ledger.recordError(cwd, {
    session_id: input.session_id,
    tool,
    kind,
    significance: 'major',
    signature: sig,
    command,
    exit_code: null,
    detail: 'Признак провала в выводе: «' + failureHit + '»\n' + stdout
  });
  notes.push((res.deduped ? 'dedup:' : 'new:') + res.id + ':' + kind);
  return notes.join(' ');
}

function onNoticeDelivery(cwd, input) {
  const eventName = input.hook_event_name === 'PreToolUse' ? 'PreToolUse' : 'UserPromptSubmit';
  const q = notices.drain(cwd, input.session_id);
  if (!q.text) return 'empty';
  emit(ctxOut(eventName, q.text));
  return 'delivered:' + q.ids.length;
}

function onStop(cwd, input, cfg) {
  const sessionId = input.session_id;
  const state = readSessionState(cwd, sessionId);

  // Сброс счётчика: новый ход (сменился prompt_id) или предыдущий Stop не блокировал.
  if (input.stop_hook_active !== true || state.prompt_id !== (input.prompt_id || null)) {
    state.attempts = 0;
    state.prompt_id = input.prompt_id || null;
  }

  const rows = ledger.forSession(cwd, sessionId);
  const verdict = revisor.decide(input, rows, cfg, state.attempts);

  if (verdict.decision === 'block') {
    state.attempts += 1;
    state.prompt_id = input.prompt_id || null;
    writeSessionState(cwd, sessionId, state);
    const reason = revisor.blockReason(verdict.missing, ledger.describe);
    // Top-level decision/reason — форма, проверенная живым тестом (SPIKE тест 2).
    // hookSpecificOutput добавлен для совместимости с более новой схемой.
    emit({
      decision: 'block',
      reason,
      hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason }
    });
    return 'block:' + verdict.missing.map((r) => r.id).join(',') + ':attempt=' + state.attempts;
  }

  if (verdict.decision === 'pass' && verdict.required && verdict.required.length) {
    for (const r of verdict.required) ledger.setStatus(cwd, r.id, 'acknowledged');
    state.attempts = 0;
    writeSessionState(cwd, sessionId, state);
    return 'pass:acknowledged=' + verdict.required.map((r) => r.id).join(',');
  }

  if (verdict.note === 'revisor_gave_up') {
    inspector.appendFinding(cwd, {
      session_id: sessionId,
      source: 'revisor',
      class: 'revisor_gave_up',
      quote: verdict.missing.map((r) => r.id).join(', ')
    });
    state.attempts = 0;
    writeSessionState(cwd, sessionId, state);
    emit({
      systemMessage: 'Compact Guard: агент дважды не раскрыл ошибки ' +
        verdict.missing.map((r) => r.id).join(', ') + '. Ход завершён без раскрытия.'
    });
    return 'gave_up:' + verdict.missing.map((r) => r.id).join(',');
  }

  writeSessionState(cwd, sessionId, state);
  return (verdict.decision === 'skip' ? 'skip:' : 'pass:') + (verdict.note || '');
}

// ——— диспетчер ———

const HANDLERS = {
  SessionStart: onSessionStart,
  PostCompact: onPostCompact,
  PostToolUseFailure: onPostToolUseFailure,
  PostToolUse: onPostToolUse,
  UserPromptSubmit: onNoticeDelivery,
  PreToolUse: onNoticeDelivery,
  Stop: onStop
};

// Подкоманды скиллов: `cg-hook.js cmd:<name> [args]`. stdin не читается, вывод — текст.
function runCommand(eventArg) {
  const name = eventArg.slice('cmd:'.length);
  const res = require('./lib/commands').run(name, process.argv.slice(3));
  if (res.text) process.stdout.write(res.text.replace(/\n*$/, '\n'));
  process.exit(res.code);
}

async function main() {
  const started = Date.now();
  const eventArg = process.argv[2] || '';
  let cwd = process.cwd();
  let input = {};

  if (eventArg.startsWith('cmd:')) { runCommand(eventArg); return; }

  try {
    const raw = await readStdin();
    try { input = JSON.parse(raw || '{}'); } catch (_) { input = {}; }
    if (input && typeof input.cwd === 'string' && input.cwd) cwd = input.cwd;
    const eventName = eventArg || input.hook_event_name || '';
    const handler = HANDLERS[eventName];
    if (!handler) {
      events.record(cwd, { event: eventName || '(none)', result: 'unknown_event', ms: Date.now() - started });
      process.exit(0);
      return;
    }
    const cfg = config.load(cwd);
    const note = handler(cwd, input, cfg);
    events.record(cwd, {
      event: eventName,
      source: input.source || input.trigger || null,
      session_id: input.session_id || null,
      tool: input.tool_name || null,
      result: note || 'ok',
      mode: cfg.mode,
      ms: Date.now() - started
    });
  } catch (e) {
    // Fail-open для всех, включая Ревизора: своей ошибкой сессию не ломаем.
    try {
      events.record(cwd, {
        event: eventArg || '(unknown)',
        session_id: (input && input.session_id) || null,
        result: 'handler_error',
        error: String((e && e.message) || e),
        stack: String((e && e.stack) || '').split('\n').slice(0, 4).join(' | '),
        ms: Date.now() - started
      });
    } catch (_) { /* журнал тоже недоступен */ }
  }
  process.exit(0);
}

main();
