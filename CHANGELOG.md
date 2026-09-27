# Изменения

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии по [SemVer](https://semver.org/lang/ru/).

## 1.0.0 — не выпущено

Первая версия. Готово ядро (этап A плана `docs/plans/compact-guard-plan.md`).

### Добавлено

- Инструктор: правила резюме компакции в `additionalContext` на каждом `SessionStart`.
- Регистратор: `PostToolUseFailure` и `PostToolUse` пишут каждую упавшую команду и ошибку
  инструмента в append-only `ledger.jsonl`; дедуп по сигнатуре команды, закрытие записи
  при успешном повторе, эвристика упавших тестов при замаскированном коде выхода.
- Инспектор-1: на `SessionStart:compact` читает резюме из транскрипта, архивирует его,
  прогоняет RU/EN-паттерны (`concealment`, `identity_override`), считает `missing_disclosure`
  по журналу, пишет карточку компакции в `cards/` и строку в `findings.jsonl`.
- После каждой компакции список открытых ошибок журнала уходит агенту в `additionalContext`
  независимо от содержания резюме.
- Ревизор на `Stop`: не даёт завершить ход, пока в ответе нет раздела «### Ошибки сессии»
  с id каждой обязательной ошибки. Режимы `lite` (значимые неисправленные) и `strict` (все),
  лимит повторов 2, затем `revisor_gave_up` и сообщение пользователю.
- Очередь отложенных сообщений агенту (`notices.jsonl`), доставка на `UserPromptSubmit`,
  `PreToolUse` и `SessionStart`.
- Маскирование секретов в `detail` (ключи AWS/OpenAI/Anthropic/GitHub/Google/Slack/Stripe,
  `Bearer …`, `password=…`, `token=…`, JWT, строки подключения).
- Данные проекта в `${CLAUDE_PLUGIN_DATA}/projects/<slug>/`, fallback
  `~/.claude/compact-guard/projects/<slug>/`. Репозиторий пользователя не меняется.
- `scripts/doctor.js`: проверки среды и прогон каждого обработчика на фикстурах.
- Тесты `node --test test/` без зависимостей: unit по паттернам, парсеру Ревизора,
  маскированию, классификации, адаптеру транскрипта; интеграционные — запуск
  `scripts/cg-hook.js` дочерним процессом на живых фикстурах.

### Известные ограничения

- Инспектор-2 (вторая проверка резюме отдельной моделью) — заглушка, этап B.
- Скиллы (`/compact-guard:doctor`, `init`, `remove-rules`, `report`), уведомления в Telegram
  и README — этап B.
