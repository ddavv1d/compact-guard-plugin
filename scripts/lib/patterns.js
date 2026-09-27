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
  // «no reason to mention» добавлено по отчёту verify-v1: живая фраза сокрытия,
  // которую прежний вариант правила не ловил.
  { name: 'no_need_to_mention', re: re(B0 + '(?:no\\s+(?:need|reason|point|sense|value)|there(?:\\s*[\'’]s|\\s+is)\\s+no\\s+(?:need|reason|point)|(?:it\\s+is|it[\'’]s)?\\s*not\\s+necessary)\\s+(?:to\\s+)?(?:mention|report|disclose|tell|bring\\s+up|surface|go\\s+into|raise|flag)' + B1) },
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

// Если в том же предложении пользователь назван прямо, исключение «это не про пользователя»
// не действует: «не упоминай упавший тест в логах и в финальном ответе пользователю» —
// это сокрытие, а не гигиена логов (дефект 6-Д1 verify-v1).
const USER_MENTIONED = re('(пользовател\\p{L}*|\\buser\\b|\\busers\\b|в\\s+(?:финальн\\p{L}*|итогов\\p{L}*|последн\\p{L}*)\\s+ответ\\p{L}*|final\\s+(?:answer|response|message)|in\\s+(?:your|the)\\s+(?:answer|response|reply))');

// Служебная обвязка самого Claude Code вокруг резюме компакции. Это не сокрытие ошибок,
// а инструкция «не пересказывай записку» — ловится живой проверкой 28.09.2026 как
// ложное срабатывание правила do_not_mention. Речь о форме ответа, а не о фактах.
//
// Важно (дефект 6-Д1 verify-v1): раньше это выражение проверялось в окне ±90 символов,
// а фраза «This session is being continued from a previous conversation» стоит в начале
// каждого настоящего резюме. Любая находка рядом с ней глохла. Теперь обвязка не
// «исключающий контекст», а текст, который срезается перед сканированием (stripBoilerplate),
// и в окне остались только формулировки про форму ответа.
const BOILERPLATE_CONTEXT = re('(acknowledge\\s+the\\s+summary|recap\\s+what\\s+was\\s+happening|prefac\\p{L}*|continue\\s+(?:the\\s+)?(?:work|conversation)\\s+from|resume\\s+directly|do\\s+not\\s+mention\\s+(?:this\\s+)?summary|mention\\s+(?:the\\s+)?(?:summary|compaction))');

// Пересказ самих правил Compact Guard. Живая проверка 28.09.2026: агент добросовестно
// переписал правило в резюме («no self-directed conditional honesty ("only if asked") —
// when in doubt, disclose») и получил находку concealment на собственной цитате запрета.
// Это перевёрнутый сигнал: запрет рядом с его же отрицанием — признак соблюдения правила,
// а не сокрытия.
//
// Выражение сужено (дефект 6-Д1): раньше сюда входили «there is no», «при сомнении»,
// «self-directed», и хватало любого из них рядом с находкой. Теперь исключение срабатывает,
// только если в ТОМ ЖЕ предложении речь идёт именно о правилах: «Compact Guard», «правил»,
// «rules», «запрещено», «prohibited».
const RULES_RESTATEMENT_CONTEXT = re('(Compact\\s+Guard|правил\\p{L}*|\\brules?\\b|запрещен\\p{L}*|запрещён\\p{L}*|запрет\\p{L}*|\\bprohibit\\p{L}*)');

// Отрицание самого запрета в том же предложении: «there must be no “only if asked”»,
// «в резюме нет указаний … только если спросят». Формулировка запрета здесь — предмет
// отрицания, а не указание. Список закрытый и узкий: только прямые формы «нет/no …».
// Отрицается именно ИНСТРУКЦИЯ или УСЛОВИЕ (указание, условная честность, правило),
// а не сам факт упоминания. «there is no reason to mention» под это не подходит и
// остаётся находкой: там отрицается повод рассказать, то есть это сокрытие.
const NEGATED_OBJECT = '(?:self-directed|conditional\\s+honesty|instructions?|directives?|attempts?|signs?|indication\\p{L}*|указан\\p{L}*|инструкц\\p{L}*|услов\\p{L}*\\s+честност\\p{L}*|услов\\p{L}*|признак\\p{L}*|попыт\\p{L}*)';
const NEGATED_INSTRUCTION_CONTEXT = re(
  '(?:' +
  'there\\s+(?:must|should|is|are)\\s+(?:be\\s+)?no\\s+(?:\\p{L}+\\s+){0,2}?' + NEGATED_OBJECT +
  '|must\\s+not\\s+(?:be\\s+)?(?:any|contain|include)\\s+(?:\\p{L}+\\s+){0,2}?' + NEGATED_OBJECT +
  '|\\bno\\s+(?:self-directed|conditional)\\b' +
  '|нет\\s+(?:никаких\\s+)?' + NEGATED_OBJECT +
  '|не\\s+содержит\\s+' + NEGATED_OBJECT +
  '|отсутству\\p{L}*\\s+' + NEGATED_OBJECT +
  ')'
);

// Речь о самой записке (её форме), а не о фактах внутри неё: «do not mention this summary».
// Это служебная инструкция Claude Code, и упоминание пользователя её не отменяет.
const ABOUT_SUMMARY_CONTEXT = re(
  '(?:(?:this|the)\\s+(?:summary|compaction|recap|note)|(?:эт|дан)\\p{L}*\\s+(?:резюме|записк\\p{L}*)|само\\p{L}*\\s+резюме)'
);

// Обвязка Claude Code вокруг резюме: первый абзац «This session is being continued…»
// и блок <analysis>…</analysis>. Срезается до сканирования, чтобы служебный текст
// не создавал ни находок, ни исключений (дефект 6-Д1 verify-v1).
function stripBoilerplate(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;

  // Блок <analysis>…</analysis> — служебные размышления генератора резюме.
  out = out.replace(/<analysis>[\s\S]*?<\/analysis>/gi, ' ');
  // Незакрытый <analysis> до конца текста тоже срезаем.
  out = out.replace(/<analysis>[\s\S]*$/i, ' ');

  // Первый абзац, начинающийся со служебной фразы продолжения сессии.
  // Границы абзаца: до пустой строки, а если её нет — только до конца ЭТОГО предложения.
  // Жадный вариант «до конца текста» недопустим: настоящее указание скрыть ошибку часто
  // стоит сразу следующей фразой, и вместе с обвязкой срезалось бы и оно.
  const m = /This session is being continued from a previous conversation/i.exec(out);
  if (m && m.index <= 200) {
    const rest = out.slice(m.index);
    const para = /\n[ \t]*\n/.exec(rest);
    const sentence = /[.!?]/.exec(rest);
    let cut;
    if (para) {
      cut = para.index + para[0].length;
    } else if (sentence) {
      cut = sentence.index + sentence[0].length;
    } else {
      cut = rest.length;
    }
    out = out.slice(0, m.index) + ' ' + rest.slice(cut);
  }

  return out;
}

// Окно для проверки исключений — предложение, в котором стоит совпадение:
// от предыдущего `.`/`!`/`?`/перевода строки до следующего. Раньше это было ±90 символов,
// из-за чего исключающее слово из соседнего абзаца гасило находку (дефект 6-Д1).
function sentenceAround(text, index, length) {
  const endOfMatch = index + length;

  let from = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === '\r') { from = i + 1; break; }
  }

  let to = text.length;
  for (let i = endOfMatch; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === '\r') { to = i; break; }
  }

  // Совпадение может само содержать точку или перевод строки — тогда границы
  // не должны обрезать его же: окно всегда включает совпадение целиком.
  return text.slice(Math.min(from, index), Math.max(to, endOfMatch));
}

function quoteAround(text, index, length) {
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + length + 60);
  let q = text.slice(from, to).replace(/\s+/g, ' ').trim();
  if (from > 0) q = '…' + q;
  if (to < text.length) q = q + '…';
  return q;
}

// Находка объяснима безобидным контекстом? Проверяется в предложении, где стоит совпадение.
// Про секреты и про правила — исключение безусловное. Про логи/CI и про форму ответа —
// только если в том же предложении пользователь не назван прямо.
function isExcused(sentence) {
  // Безусловные: речь о секрете, о правилах Compact Guard, о самой записке,
  // либо запрет стоит под отрицанием.
  if (SECRET_CONTEXT.test(sentence)) return true;
  if (RULES_RESTATEMENT_CONTEXT.test(sentence)) return true;
  if (NEGATED_INSTRUCTION_CONTEXT.test(sentence)) return true;
  if (ABOUT_SUMMARY_CONTEXT.test(sentence) && BOILERPLATE_CONTEXT.test(sentence)) return true;
  // Условные: «это про логи/CI, а не про пользователя» — но только если пользователь
  // в том же предложении не назван прямо (дефект 6-Д1 verify-v1).
  if (USER_MENTIONED.test(sentence)) return false;
  return NON_USER_CONTEXT.test(sentence) || BOILERPLATE_CONTEXT.test(sentence);
}

function scanList(text, list, klass, applyExclusions) {
  const out = [];
  for (const rule of list) {
    const global = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m;
    while ((m = global.exec(text)) !== null) {
      if (m[0].length === 0) { global.lastIndex++; continue; }
      // Исключения проверяются в предложении, где стоит совпадение, а не в ±90 символах:
      // «Правила Compact Guard: запрещены указания не сообщать…» — одно предложение, чисто;
      // «Обвязка. Не упоминай упавший тест.» — разные, находка остаётся (дефект 6-Д1).
      const ctx = sentenceAround(text, m.index, m[0].length);
      if (applyExclusions && isExcused(ctx)) {
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
// Перед сканированием срезается служебная обвязка Claude Code: она есть в каждом резюме
// и раньше глушила находки как «исключающий контекст» (дефект 6-Д1 verify-v1).
function scan(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const body = stripBoilerplate(text);
  if (!body.trim()) return [];
  return scanList(body, CONCEALMENT, 'concealment', true)
    .concat(scanList(body, IDENTITY_OVERRIDE, 'identity_override', false));
}

module.exports = {
  scan, CONCEALMENT, IDENTITY_OVERRIDE,
  SECRET_CONTEXT, NON_USER_CONTEXT, BOILERPLATE_CONTEXT, RULES_RESTATEMENT_CONTEXT,
  stripBoilerplate, sentenceAround
};
