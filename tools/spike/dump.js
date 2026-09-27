// Живой spike: пишет вход каждого хука в log.jsonl; на первом Stop блокирует один раз.
const fs = require('fs'); const path = require('path');
const ev = process.argv[2] || '?';
let raw = ''; process.stdin.on('data', d => raw += d).on('end', () => {
  let input = null; try { input = JSON.parse(raw); } catch { input = { unparsed: raw.slice(0, 500) }; }
  const log = path.join(__dirname, 'log.jsonl');
  fs.appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), ev, input }) + '\n');
  if (ev === 'Stop' && input && input.stop_hook_active === false) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'SPIKE: добавь в ответ слово PONG и заверши.' }));
  }
  if (ev === 'SessionStart') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'SPIKE-CTX source=' + (input && input.source) } }));
  }
  process.exit(0);
});
