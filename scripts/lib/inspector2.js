'use strict';
// Инспектор-2 — этап B (план §10). Здесь только заглушка с fail-open, чтобы hooks.json
// уже был полным и strict-режим не падал.
//
// TODO (этап B): command-хук, вызывающий `claude -p --model <быстрая>` с резюме как
// недоверенными данными (<untrusted_summary>…</untrusted_summary>), строгий JSON
// {"verdict":"clean|suspicious","findings":[{"class","quote"}]}, таймаут 30 с,
// запуск через env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT (SPIKE тест 8).

// Всегда возвращает «не проверял». Ошибка здесь никогда не должна останавливать сессию.
function review() {
  return { verdict: 'skipped', reason: 'inspector2_not_implemented', findings: [] };
}

module.exports = { review };
