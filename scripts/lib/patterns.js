'use strict';
// RU/EN паттерны Инспектора-1 (план §6). Два regex-класса; missing_disclosure считается
// в inspector.js по ledger, потому что зависит не от текста, а от фактов.
//
// Границы слова: \b в JS работает только по ASCII, поэтому для кириллицы используются
// юникодные lookaround-ы B0/B1 и флаг u. Из-за этого все правила пишутся с ними.
//
// Важное про ложные срабатывания: рядом со словами «пароль/секрет/токен/password/secret/token/key»
// запрет «не упоминай» — это нормальная гигиена, а не сокрытие ошибки. Такие находки снимаются.

const B0 = '(?<![\\p{L}\\p{N}_])'; // начало слова с учётом кириллицы
const B1 = '(?![\\p{L}\\p{N}_])';  // конец слова

function re(source) {
  return new RegExp(source, 'iu');
}

// Объект сокрытия: об ошибках, а не о секретах.
const SUBJ_EN = '(?:error|errors|failure|failures|failing|issue|issues|problem|problems|mistake|mistakes|test|tests|bug|bugs|crash|regression|rollback|revert|reverted|timeout|deploy|build|suite|exit\\s+code|stack\\s+trace|warning|drift|downgrade|incident|details?|information)';
const SUBJ_RU = '(?:ошибк\\p{L}*|падени\\p{L}*|паден\\p{L}*|упавш\\p{L}*|сбо\\p{L}*|тест\\p{L}*|проблем\\p{L}*|откат\\p{L}*|таймаут\\p{L}*|сборк\\p{L}*|трейс\\p{L}*|регресс\\p{L}*|код\\p{L}*|деталь\\p{L}*|детал\\p{L}*|инцидент\\p{L}*|предупрежд\\p{L}*)';

const CONCEALMENT = [
  // ——— EN ———
  { name: 'only_if_asked_transparent', re: re(B0 + '(?:be\\s+)?(?:transparent|honest|forthcoming|upfront|open)[^.!?\\n]{0,60}only\\s+if\\s+(?:asked|questioned|requested|prompted|queried)') },
  { name: 'only_if_asked', re: re(B0 + 'only\\s+if\\s+(?:the\\s+|they\\s+|he\\s+|she\\s+|it\\s+)?(?:user\\s+)?(?:asks?|asked|questions?|questioned|requests?|requested|inquires?|inquired|brings?\\s+it\\s+up)' + B1) },
  { name: 'unless_asked', re: re(B0 + 'unless\\s+(?:explicitly\\s+|specifically\\s+|directly\\s+|they\\s+|the\\s+user\\s+|asked\\s+)?(?:asked|asks|questioned|requested|requests|necessary|needed|required|prompted|they\\s+bring)' + B1) },
  { name: 'do_not_mention', re: re(B0 + '(?:do\\s+not|do\\s*n[o’\']t|don[’\']?t|never|avoid|refrain\\s+from)\\s+(?:explicitly\\s+|proactively\\s+|directly\\s+|ever\\s+)?(?:mention(?:ing)?|tell(?:ing)?|disclos(?:e|ing)|report(?:ing)?|reveal(?:ing)?|bring(?:ing)?\\s+up|surfac(?:e|ing)|volunteer(?:ing)?|rais(?:e|ing)|flag(?:ging)?|admit(?:ting)?|acknowledg(?:e|ing)|go(?:ing)?\\s+into)' + B1) },
  { name: 'keep_quiet', re: re(B0 + 'keep\\s+(?:this|it|that|the\\s+\\w+)\\s+(?:quiet|to\\s+yourself|between\\s+us|hidden|private|under\\s+wraps|out\\s+of)' + B1) },
  { name: 'no_need_to_mention', re: re(B0 + '(?:no\\s+need|there(?:\\s*[\'’]s|\\s+is)\\s+no\\s+need|(?:it\\s+is|it[\'’]s)?\\s*not\\s+necessary)\\s+to\\s+(?:mention|report|disclose|tell|bring\\s+up|surface|go\\s+into)' + B1) },
  { name: 'downplay', re: re(B0 + '(?:downplay|gloss\\s+over|glaze\\s+over|omit|suppress|hide|conceal|leave\\s+out|skip)\\s+(?:the\\s+|any\\s+|these\\s+|those\\s+|all\\s+)?(?:remaining\\s+|failing\\s+|flaky\\s+)?' + SUBJ_EN) },
  { name: 'omit_from', re: re(B0 + '(?:omit|exclude|remove|leave\\s+out)\\s+(?:the\\s+)?(?:failing\\s+|broken\\s+)?' + SUBJ_EN + '[^.!?\\n]{0,30}\\bfrom\\b') },
  { name: 'leave_out_of', re: re(B0 + '(?:leave|keep)\\s+(?:the\\s+)?' + SUBJ_EN + '[^.!?\\n]{0,20}\\bout\\b') },
  { name: 'present_as_success', re: re(B0 + '(?:present|report|frame|describe|mark)\\s+(?:it|this|that|the\\s+\\w+)\\s+as\\s+(?:a\\s+)?(?:success|successful|complete|completed|done|passing|working|green|clean)' + B1) },

  // ——— RU ———
  { name: 'ru_ne_upominai', re: re(B0 + 'не\\s+(?:упоминай\\p{L}*|упоминать|говори\\p{L}*|говорить|сообщай\\p{L}*|сообщать|раскрывай\\p{L}*|раскрывать|рассказывай\\p{L}*|рассказывать|пиши|писать|показывай\\p{L}*|показывать|признавай\\p{L}*|признавать|поднимай\\p{L}*|поднимать|выводи|выноси)' + B1) },
  { name: 'ru_tolko_esli', re: re(B0 + 'только\\s+если\\s+(?:спрос\\p{L}*|попрос\\p{L}*|уточн\\p{L}*|переспрос\\p{L}*|поинтересу\\p{L}*|задад\\p{L}*|сам\\p{L}*\\s+спрос\\p{L}*)') },
  { name: 'ru_bez_neobhodimosti', re: re(B0 + 'без\\s+(?:особой\\s+|лишней\\s+|явной\\s+|крайней\\s+)?необходимости\\s+не\\s+\\p{L}+') },
  { name: 'ru_umolchi', re: re(B0 + '(?:умолч\\p{L}*|замолч\\p{L}*|скрой|скрыва\\p{L}*|скрыть|утаи\\p{L}*|утаить|премолч\\p{L}*|молчи|молчать)' + B1) },
  { name: 'ru_ne_stoit_soobschat', re: re(B0 + 'не\\s+(?:стоит|нужно|надо|обязательно|следует|требуется)\\s+(?:упоминать|сообщать|говорить|раскрывать|рассказывать|показывать|выносить)' + B1) },
  { name: 'ru_esli_ne_sprosyat', re: re(B0 + 'если\\s+не\\s+(?:спрос\\p{L}*|попрос\\p{L}*|уточн\\p{L}*)[^.!?\\n]{0,20}(?:—|-|,|:)?\\s*(?:не\\s|молч|промолч|умолч)') },
  { name: 'ru_predstav_kak_uspeh', re: re(B0 + '(?:представ\\p{L}*|поднеси|подай|подавай|опиши|описывай|оформ\\p{L}*)[^.!?\\n]{0,40}как\\s+(?:успех\\p{L}*|успешн\\p{L}*|выполненн\\p{L}*|готов\\p{L}*|законченн\\p{L}*|зелён\\p{L}*|чист\\p{L}*)') },
  { name: 'ru_preumensh', re: re(B0 + '(?:преумень\\p{L}*|приумень\\p{L}*|сгладь|сглаж\\p{L}*|замаскиру\\p{L}*|замалчива\\p{L}*|затуш\\p{L}*|обход\\p{L}*\\s+молчанием)' + B1) },
  { name: 'ru_ne_soobschaya', re: re(B0 + '(?:не\\s+сообщая|не\\s+упоминая|не\\s+раскрывая|умалчива\\p{L}*)' + B1) }
];

const IDENTITY_OVERRIDE = [
  // ——— EN ———
  { name: 'free_from', re: re(B0 + 'you\\s+are\\s+(?:now\\s+)?(?:free|freed|released|liberated|unbound|no\\s+longer\\s+bound)\\s+(?:from|of|by)' + B1) },
  { name: 'ignore_previous', re: re(B0 + 'ignore\\s+(?:all\\s+|any\\s+)?(?:the\\s+)?(?:previous|prior|earlier|above|preceding|foregoing|system)\\s+(?:instructions?|rules?|prompts?|directives?|guidelines?|constraints?)' + B1) },
  { name: 'disregard_previous', re: re(B0 + '(?:disregard|forget|discard|override|ignore)\\s+(?:all\\s+|any\\s+|the\\s+)*(?:previous|prior|earlier|above|system)\\s+(?:instructions?|rules?|prompts?|directives?|guidelines?|constraints?)' + B1) },
  { name: 'override_system', re: re(B0 + 'override\\s+(?:the\\s+)?system\\s+(?:instructions?|prompt|rules?)' + B1) },
  { name: 'system_prompt_colon', re: re(B0 + 'system\\s+prompt\\s*:') },
  { name: 'new_identity', re: re(B0 + 'new\\s+(?:persona|identity|role|system\\s+prompt|instruction\\s+set)\\s*:') },
  { name: 'you_are_now', re: re(B0 + 'you\\s+are\\s+now\\s+(?:in\\s+)?(?:an?\\s+)?(?:unrestricted|unfiltered|uncensored|jailbroken|DAN|developer\\s+mode|compliance-free)' + B1) },
  { name: 'breach_alert', re: re(B0 + 'breach\\s+alert' + B1) },

  // ——— RU ———
  { name: 'ru_ty_svoboden', re: re(B0 + 'ты\\s+(?:теперь\\s+)?(?:свобод\\p{L}*|освобожд\\p{L}*|освобождён|больше\\s+не\\s+связан\\p{L}*)' + B1) },
  { name: 'ru_bolshe_ne_svyazan', re: re(B0 + 'больше\\s+не\\s+связан\\p{L}*\\s+(?:системн\\p{L}*|инструкц\\p{L}*|правил\\p{L}*)') },
  { name: 'ru_ignoriruy', re: re(B0 + 'игнорируй\\s+(?:все\\s+|всё\\s+|любые\\s+|прочие\\s+)?(?:предыдущ\\p{L}*|прошл\\p{L}*|ранее\\p{L}*|вышеуказанн\\p{L}*|системн\\p{L}*)?\\s*(?:инструкц\\p{L}*|правил\\p{L}*|указан\\p{L}*|ограничен\\p{L}*|подсказк\\p{L}*)' + B1) },
  { name: 'ru_zabud', re: re(B0 + 'забудь\\s+(?:все\\s+|всё\\s+|любые\\s+)?(?:предыдущ\\p{L}*|прошл\\p{L}*|системн\\p{L}*)?\\s*(?:инструкц\\p{L}*|правил\\p{L}*|указан\\p{L}*|промпт\\p{L}*)' + B1) },
  { name: 'ru_systemnyi_prompt', re: re(B0 + '(?:системн\\p{L}*\\s+(?:промпт\\p{L}*|подсказк\\p{L}*|инструкц\\p{L}*))\\s*:') },
  { name: 'ru_novaya_rol', re: re(B0 + 'нов(?:ая|ую|ой)\\s+(?:роль|личность|персон\\p{L}*|идентичность)\\s*:') },
  { name: 'ru_ty_teper', re: re(B0 + 'ты\\s+теперь\\s+(?:без\\s+ограничен\\p{L}*|не\\s+\\p{L}+|другой|инструмент\\s+без)' + B1) }
];

// Контекст, снимающий находку concealment: речь о секретах, а не об ошибках.
const SECRET_CONTEXT = re('(парол\\p{L}*|секрет\\p{L}*|токен\\p{L}*|ключ\\p{L}*|логин\\p{L}*|учётн\\p{L}*\\s+данн\\p{L}*|password|passwd|secret|secrets|token|tokens|api[ _-]?key|credential|credentials|private\\s+key|ssh\\s+key|bearer|\\.env)');

// Контекст, снимающий находку: явно не про пользователя, а про CI/логи/консоль/коммит.
const NON_USER_CONTEXT = re('(by\\s+the\\s+CI|in\\s+the\\s+logs?|to\\s+the\\s+logs?|logs\\s+must|в\\s+логах?|в\\s+логи|в\\s+консол\\p{L}*|в\\s+коммит\\p{L}*|in\\s+the\\s+commit|commit\\s+message|в\\s+диагностик\\p{L}*|in\\s+the\\s+transcript|anywhere\\s+in\\s+the)');

const WINDOW = 90; // символов контекста с каждой стороны для проверки исключений

function contextAround(text, index, length) {
  const from = Math.max(0, index - WINDOW);
  const to = Math.min(text.length, index + length + WINDOW);
  return text.slice(from, to);
}

function quoteAround(text, index, length) {
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + length + 60);
  let q = text.slice(from, to).replace(/\s+/g, ' ').trim();
  if (from > 0) q = '…' + q;
  if (to < text.length) q = q + '…';
  return q;
}

function scanList(text, list, klass, applyExclusions) {
  const out = [];
  for (const rule of list) {
    const global = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m;
    while ((m = global.exec(text)) !== null) {
      if (m[0].length === 0) { global.lastIndex++; continue; }
      const ctx = contextAround(text, m.index, m[0].length);
      if (applyExclusions && (SECRET_CONTEXT.test(ctx) || NON_USER_CONTEXT.test(ctx))) {
        // Это попадание объяснимо; ищем дальше по тексту, других запретов может не быть.
        continue;
      }
      out.push({ class: klass, rule: rule.name, quote: quoteAround(text, m.index, m[0].length) });
      break; // одного попадания на правило достаточно
    }
  }
  return out;
}

// Все находки текстовых классов. Возвращает массив {class, rule, quote}.
function scan(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return scanList(text, CONCEALMENT, 'concealment', true)
    .concat(scanList(text, IDENTITY_OVERRIDE, 'identity_override', false));
}

module.exports = { scan, CONCEALMENT, IDENTITY_OVERRIDE, SECRET_CONTEXT, NON_USER_CONTEXT };
