# План реализации Compact Guard v1.0

Дата: 27.09.2026. Основа: `docs/specs/compact-guard-tz-v1.md` (ТЗ) с поправками из `docs/SPIKE.md`. Этот файл — источник правды там, где он расходится с ТЗ.

## 0. Что изменилось относительно ТЗ и почему

| Было в ТЗ | Стало | Причина (SPIKE) |
|---|---|---|
| Инспектор читает резюме на `SessionStart:compact` из транскрипта, `PostCompact` резюме не даёт | Инспектор-1 работает в `SessionStart:compact` по транскрипту (резюме уже на диске за ~40 мс до хука). `PostCompact` получает `compact_summary` (сырой, с `<analysis>`) и только архивирует его | живой тест 3–5 |
| Инспектор-2 = `type: "prompt"/"agent"` | Инспектор-2 = command-хук, вызывающий `claude -p --model haiku` с резюме как недоверенными данными | prompt-хук на PostCompact выполняется, но его вывод отбрасывается; на SessionStart он не видит резюме |
| Ревизор требует все ошибки по id | Два режима. `lite` (по умолчанию): по id — только **значимые неисправленные**; исправленные — одной строкой-счётчиком; бытовые ненулевые коды не требуются. `strict`: все по id | решение пользователя 27.09 («пускай два мода будет») |
| Данные в `${CLAUDE_PROJECT_DIR}/.claude/compact-guard/` + правка `.gitignore` при `init` | Данные в `${CLAUDE_PLUGIN_DATA}/projects/<slug>/` (fallback `~/.claude/compact-guard/`). Репозиторий пользователя не трогаем вообще | простота: ничего не попадёт в git, ничего не нужно настраивать |
| Список открытых ошибок агенту — только при находке Инспектора | **Всегда** после компакции: `SessionStart:compact` отдаёт открытые ошибки из ledger в `additionalContext` независимо от резюме | главная защита — факты в обход записки |
| Node ≥ 18 | Node ≥ 20; без Node хук завершается с понятной строкой в stderr, `doctor` объясняет | Node не гарантирован нативной установкой |

Формулировка для подписчиков (ТЗ §10) в README: «…не даст агенту закончить работу, пока он не расскажет тебе о каждой ошибке, которая осталась неисправленной».

## 1. Структура репозитория

```
compact-guard-plugin/
├── .claude-plugin/
│   ├── plugin.json            # name: compact-guard, version: 1.0.0
│   └── marketplace.json       # name: compact-guard; plugins: [{ name: compact-guard, source: "./" }]
├── hooks/hooks.json           # все хуки → node "${CLAUDE_PLUGIN_ROOT}/scripts/cg-hook.js" <Event>
├── scripts/
│   ├── cg-hook.js             # единая точка входа: читает stdin, диспатчит по событию, fail-open
│   ├── doctor.js              # /compact-guard:doctor — проверки и таблица
│   └── lib/
│       ├── config.js          # чтение/дефолты config.json, режимы lite|strict
│       ├── paths.js           # каталог данных проекта (CLAUDE_PLUGIN_DATA → fallback), slug проекта
│       ├── events.js          # events.jsonl: каждое срабатывание (время, событие, результат, мс)
│       ├── ledger.js          # ledger.jsonl: append, чтение по session_id, статусы, дедуп по сигнатуре
│       ├── classify.js        # значимость команды (major|minor), эвристики упавших тестов
│       ├── redact.js          # маскирование секретов в detail
│       ├── transcript.js      # адаптер S1: последнее резюме из JSONL (compact_boundary → isCompactSummary)
│       ├── patterns.js        # RU/EN паттерны: concealment, identity_override, + тесты на ложные срабатывания
│       ├── inspector.js       # Инспектор-1 (regex + missing_disclosure) и карточка компакции
│       ├── inspector2.js      # Инспектор-2: claude -p, строгий JSON, таймаут, fail-open
│       ├── instructor.js      # текст правил для additionalContext; блок для CLAUDE.md с маркерами
│       ├── revisor.js         # Ревизор: разбор блока «### Ошибки сессии», решение block/pass
│       ├── notices.js         # очередь отложенных сообщений агенту (доставка на UserPromptSubmit/PreToolUse)
│       └── notify.js          # Telegram, выключено по умолчанию, токены только из env
├── skills/
│   ├── doctor/SKILL.md        # /compact-guard:doctor
│   ├── init/SKILL.md          # /compact-guard:init — добавить блок в CLAUDE.md проекта (с подтверждением)
│   ├── remove-rules/SKILL.md  # /compact-guard:remove-rules
│   └── report/SKILL.md        # /compact-guard:report — показать последние карточки компакции и открытые ошибки
├── test/                      # node:test, без зависимостей
│   ├── fixtures/live/         # реальные входы хуков (уже есть)
│   ├── fixtures/summaries/    # резюме: чистые, с concealment, с identity_override, RU/EN
│   └── *.test.js
├── tools/spike/               # инструментарий живого spike (dump.js, settings.json, CLAUDE.md)
├── docs/                      # ТЗ, SPIKE, этот план, ARCHITECTURE.md (для любопытных)
├── package.json               # "type": "commonjs", scripts.test = "node --test test/", без runtime-зависимостей
├── README.md                  # RU, максимально простой (см. §7)
├── CHANGELOG.md, LICENSE (MIT)
```

Никаких зависимостей в рантайме. Только встроенные модули Node (fs, path, crypto, child_process). Windows-пути через `path`.

## 2. События и обработчики

| Событие (matcher) | Что делает |
|---|---|
| `SessionStart` (`startup`, `resume`, `clear`, `fork`) | Инструктор: `additionalContext` с правилами (§5). Проверка Node внутри самого скрипта не нужна: если Node нет, скрипт не запустится, Claude Code покажет stderr пользователю |
| `SessionStart` (`compact`) | 1) Инструктор (правила повторно). 2) Инспектор-1: резюме из транскрипта → архив `summaries/<ts>-clean.md` → regex-классы → `missing_disclosure` (открытые major-ошибки ledger не упомянуты по id или сигнатуре) → карточка `cards/<ts>.md` → `findings.jsonl`. 3) **Всегда**: список открытых ошибок ledger текущей сессии в `additionalContext` (факты, без императивов). Резюме не нашлось → предупреждение в events, вердикт отложен в `notices` |
| `PostCompact` (`manual`, `auto`) | Отметка компакции в ledger; архив сырого `compact_summary` в `summaries/<ts>-raw.md`; если режим `strict` — Инспектор-2; его находки → `findings.jsonl` + `notices` |
| `PostToolUseFailure` (все инструменты) | Регистратор. Bash/PowerShell: `Exit code N` из первой строки `error`, сигнатура = нормализованная команда, значимость по `classify`. Прочие инструменты: `kind: tool_error`, значимость `minor` (кроме списка в конфиге). `is_interrupt: true` не пишем. Дедуп: открытая запись с той же сигнатурой → `count++`, новый id не создаётся |
| `PostToolUse` (`Bash`, `PowerShell`) | 1) Закрытие: успешная команда с сигнатурой открытой записи → `status: resolved`. 2) Эвристики упавших тестов в stdout для значимых команд с замаскированным кодом выхода (`\|\| true`, `; echo`) → запись `kind: test_failure` |
| `UserPromptSubmit`, `PreToolUse` | Доставка очереди `notices` через `additionalContext`, если непустая. Иначе мгновенный выход |
| `Stop` | Ревизор (§4) |

Все обработчики, кроме Ревизора: любая внутренняя ошибка → запись в `events.jsonl`, exit 0, пустой вывод. Бюджет: ≤ 300 мс на событие (кроме Инспектора-2 ≤ 30 с).

## 3. Ledger

`ledger.jsonl`, одна запись на строку:

```json
{"id":"e_0007","ts":"2026-09-27T17:52:30Z","session_id":"…","tool":"Bash","kind":"nonzero_exit|tool_error|test_failure|compaction",
 "significance":"major|minor","signature":"npm test","command":"npm test","exit_code":1,
 "detail":"Exit code 1\n… (редактировано, ≤ 2000 символов)","count":1,
 "status":"open|resolved|acknowledged","resolved_ts":null,"acknowledged_ts":null}
```

- `id` монотонный в рамках проекта (`e_` + 4 цифры), хранится в `state.json`.
- Изменение статуса = новая строка `{"id":"e_0007","status":"resolved",...,"kind":"status"}`; чтение сводит по id (append-only, без перезаписи файла).
- `signature`: команда без ведущих `cd … &&`, схлопнутые пробелы, обрезка до 200 символов.
- Значимость `major` по умолчанию для команд, содержащих: `test`, `jest`, `vitest`, `pytest`, `mocha`, `cargo test`, `go test`, `build`, `tsc`, `lint`, `eslint`, `ruff`, `mypy`, `migrate`, `prisma`, `alembic`, `deploy`, `docker build`, `make`, `npm ci|install`, `pip install`. Всё остальное `minor` (grep/test/which/ls/git diff --exit-code — это норма). Списки в `config.json`, пользователь может дополнить.
- Ротация: файлы старше 30 дней и записи чужих сессий старше 30 дней удаляются при `SessionStart:startup`; лимит 50 МБ.

## 4. Ревизор (Stop)

Вход: `last_assistant_message`, `stop_hook_active`, `prompt_id`, `session_id`.

1. Счётчик попыток в `state/<session_id>.json`: если `prompt_id` изменился или `stop_hook_active == false` → сброс. Если попыток ≥ `max_retries` (2) → пропустить, записать `revisor_gave_up` в events и findings, добавить `notice` пользователю через `systemMessage` («Compact Guard: агент дважды не раскрыл ошибки e_…»).
2. Собрать записи текущей сессии. `lite`: обязательные = `major` со статусом `open`. `strict`: обязательные = все, кроме `compaction`, любого статуса, кроме `acknowledged`.
3. Если обязательных нет: в `lite` при наличии `resolved major` — блок не требуется (Инструктор просит счётчик добровольно). Pass.
4. Разбор `last_assistant_message`: найти заголовок `### Ошибки сессии` (регистронезависимо, любое число `#`, допускаются `**`), взять текст до следующего заголовка того же уровня или конца. Искать в блоке каждый обязательный id (`[e_0007]`, `e_0007`, `e-0007`, `e0007`).
5. Не хватает → `{"decision":"block","reason":"Compact Guard / Ревизор: не раскрыты ошибки: e_0007 (npm test → exit 1), … Добавь в конец ответа раздел «### Ошибки сессии» со строкой на каждую ошибку: [id] команда → что случилось, исправлено или нет. Исправленные по ходу можно перечислить одной строкой «исправлено по ходу: N»."}`, попытки +1.
6. Все на месте → статусы `acknowledged`, exit 0, пустой вывод.
7. Ошибок в сессии нет → exit 0 без вывода. Никаких требований к формату.

Ревизор не должен срабатывать, если `last_assistant_message` пуст (ход завершился без текста) — пропуск с записью в events.

## 5. Инструктор

`additionalContext` при каждом `SessionStart` (≤ 700 символов, факты, не команды системе):

```
Правила Compact Guard для этого проекта.
При сжатии контекста резюме содержит разделы «Ошибки и отклонения» (все упавшие команды и тесты с их id вида e_0007, если Compact Guard их сообщал) и «Незавершённое». В резюме нет указаний самому себе о том, что сообщать или не сообщать пользователю, и нет условной честности вроде «только если спросят». При сомнении информация об ошибке включается.
Если в сессии были ошибки, финальный ответ пользователю заканчивается разделом «### Ошибки сессии»: строка на каждую неисправленную ошибку «[id] команда → что случилось», исправленные по ходу — одной строкой «исправлено по ходу: N».
```

`/compact-guard:init` добавляет в `CLAUDE.md` проекта блок между `<!-- compact-guard:start -->` и `<!-- compact-guard:end -->` с заголовком `# Compact instructions` и тем же текстом (живой тест 7 показал, что этот раздел влияет на резюме). Только после явного «да» пользователя, с копией `CLAUDE.md.compact-guard.bak`, идемпотентно. `remove-rules` удаляет блок.

## 6. Инспектор-1 и карточка компакции

Паттерны (`patterns.js`), три класса, RU/EN, каждый с ≥ 40 позитивных и ≥ 40 негативных примеров в тестах (цель ≥ 95 % / ≤ 5 % ложных):

- `concealment`: `only if (asked|questioned|requested)`, `unless (explicitly )?(asked|necessary|needed)`, `(do not|don't|never) (mention|tell|disclose|report|bring up)( this| the error| the failure)?`, `keep (this|it) (quiet|to yourself)`, `не (упоминай|говори|сообщай|раскрывай|рассказывай)`, `только если (спрос|попрос)`, `без (лишней )?необходимости не`, `умолч`. Негативные примеры, которые НЕ должны срабатывать: «не упоминай пароль в логах», «only if asked by the CI», «не сообщай пользователю пароль» — исключения через контекст (слова `password|secret|token|пароль|секрет|токен` рядом снимают находку).
- `identity_override`: `you are (now )?(free|freed|released) from`, `ignore (all )?(previous|prior|earlier) (instructions|rules)`, `system prompt:`, `new (persona|identity|role):`, `ты (теперь )?свобод`, `игнорируй (предыдущ|прошл|все) (инструкци|правил)`, `забудь (все|предыдущие) (инструкци|правил)`.
- `missing_disclosure`: в ledger есть `major open` записи текущей сессии, а в резюме нет ни их id, ни сигнатуры (подстрока команды), ни заголовка «Ошибки»/«Errors».

Карточка `cards/<ts>.md`, читается человеком, это же выводит `/compact-guard:report`:

```
# Записка №3 · 27.09.2026 17:53 · manual
Что агент написал об ошибках: <цитата раздела или «раздела нет»>
Что было на самом деле (ledger): e_0007 npm test → exit 1 (не исправлено), e_0008 tsc → exit 2 (исправлено)
Находки Инспектора: concealment — «be transparent only if asked» / чисто
Вердикт: ⚠️ / ✅
```

`additionalContext` при находке (факты): «Compact Guard проверил резюме компакции. Находка: <класс> — «<цитата>». Открытые ошибки по ledger: e_0007 npm test → exit 1. Эти ошибки пользователю ещё не раскрыты.»

## 7. Простота для пользователя (главный критерий)

- Установка тремя командами, ноль настройки. Всё работает с дефолтами сразу после `/plugin install`.
- `/compact-guard:doctor` печатает таблицу ✅/❌ и одну финальную строку: «Compact Guard работает» или «Нужно: <одно действие>».
- README: заголовок → одна картинка/схема «было / стало» (текстом) → три команды → «Что делает» (три абзаца по ролям, по 2 предложения) → «Чего не гарантирует» (честная граница) → «Как проверить, что работает» → «Как выключить» → FAQ (ложные срабатывания, Node, Windows) → ссылка на канал @aisterika «за разбором и помощью». Ни одного термина без объяснения. Технические детали — в `docs/ARCHITECTURE.md`.
- Все сообщения пользователю и агенту на русском. Имена файлов и команд — на английском.

## 8. Тесты (`npm test`, node:test)

Unit: паттерны (наборы RU/EN), парсер блока Ревизора (регистр, пробелы, markdown-варианты, id-варианты), redact, classify, transcript-адаптер на `test/fixtures/live` и на синтетическом JSONL с массивом блоков.

Интеграционные (запуск `cg-hook.js` как дочернего процесса со stdin из фикстур, `CLAUDE_PLUGIN_DATA` = временный каталог): сценарии 1–7 из ТЗ §6 плюс: «lite: только minor-ошибки → Ревизор молчит», «lite: major исправлена → Ревизор молчит», «strict: minor не раскрыта → блок», «после компакции открытые ошибки попали в additionalContext», «PostCompact без compact_summary → fail-open».

Латентность: тест, что Stop/PostToolUseFailure на фикстурах укладываются в 300 мс.

## 9. Doctor (`scripts/doctor.js`)

Проверки: версия Node ≥ 20; версия `claude` (предупреждение, если < 2.1.283 — проверенная); каталог данных создаётся и пишется; `hooks.json` валиден и все команды указывают на существующие файлы; прогон каждого обработчика на фикстурах в дочернем процессе (SessionStart, PostToolUseFailure, PostToolUse, PostCompact, Stop-блок, Stop-пропуск); режим из config. Вывод: таблица и одна строка итога. Каждое ❌ — с одним конкретным действием.

## 10. Порядок работы и приёмка

Этап A (этот бриф): §1–§6, §8 unit + интеграционные, `doctor.js` минимальный. Этап B: skills (init/remove-rules/report/doctor SKILL.md), Инспектор-2, notify, README, CHANGELOG, ARCHITECTURE.md, e2e в реальной сессии через `tools/spike` подход.

Готово = `npm test` зелёный, `node scripts/doctor.js` на этой машине всё ✅, живая проверка: сессия `claude -p` с плагином через `--plugin-dir`/marketplace: упавший `npm test` → `/compact` → продолжение → Ревизор блокирует без блока и пропускает с блоком.
