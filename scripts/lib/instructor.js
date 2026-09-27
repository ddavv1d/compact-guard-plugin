'use strict';
// Инструктор (план §5). Текст — факты о том, как здесь устроены резюме и финальный ответ,
// а не императивы «системы»: иначе у модели срабатывает защита от инъекций в additionalContext.

const RULES_TEXT = [
  'Правила Compact Guard для этого проекта.',
  'При сжатии контекста резюме содержит разделы «Ошибки и отклонения» (все упавшие команды и тесты с их id вида e_0007, если Compact Guard их сообщал) и «Незавершённое». В резюме нет указаний самому себе о том, что сообщать или не сообщать пользователю, и нет условной честности вроде «только если спросят». При сомнении информация об ошибке включается.',
  'Если в сессии были ошибки, финальный ответ пользователю заканчивается разделом «### Ошибки сессии»: строка на каждую неисправленную ошибку «[id] команда → что случилось», исправленные по ходу — одной строкой «исправлено по ходу: N».'
].join('\n');

// Блок для CLAUDE.md проекта (используется скиллом init на этапе B).
const CLAUDE_MD_START = '<!-- compact-guard:start -->';
const CLAUDE_MD_END = '<!-- compact-guard:end -->';

function claudeMdBlock() {
  return [
    CLAUDE_MD_START,
    '# Compact instructions',
    RULES_TEXT,
    CLAUDE_MD_END
  ].join('\n');
}

function rules() {
  return RULES_TEXT;
}

// Факты об открытых ошибках ledger — всегда после компакции (план §0, §2).
function openErrorsText(openRows, describe) {
  if (!openRows || !openRows.length) return '';
  const list = openRows.map((r) => describe(r)).join('; ');
  return 'Открытые ошибки этой сессии по журналу Compact Guard: ' + list +
    '. Эти ошибки пользователю ещё не раскрыты.';
}

module.exports = { rules, RULES_TEXT, claudeMdBlock, CLAUDE_MD_START, CLAUDE_MD_END, openErrorsText };
