/**
 * English constructions that survive into a Ukrainian translation.
 *
 * A calque is grammatical, so nothing downstream notices it: the sentence
 * parses, the glossary is respected, the placeholders are intact, and it still
 * reads as translated rather than written. The clearest tell is a phrase that
 * exists in Ukrainian only because an English one does — «чи не так?» for
 * "isn't it?", «Я ціную це» for "I appreciate it".
 *
 * The list is deliberately short and high-precision. Every entry has to be
 * wrong in essentially every context it can appear in, because a check that
 * cries wolf on acceptable Ukrainian gets switched off and then catches
 * nothing. Anything arguable belongs in the prompt as guidance, not here.
 *
 * Each rule pairs the pattern with what the phrase is actually doing in
 * English, so the reviewer — human or LLM — can pick a fix that fits the line
 * instead of a mechanical substitution.
 *
 * Every pattern opens with `(?<![\p{L}\p{N}_])` rather than `\b`: JavaScript's
 * `\b` is defined over `[A-Za-z0-9_]` and never fires between a space and a
 * Cyrillic letter, so `\bчи` would match nothing at all.
 */

export type UkCalqueRule = {
  /** Short id used in QA messages and tests. */
  id: string;
  /** Matches the calque. Anchored so it cannot fire inside a longer word. */
  pattern: RegExp;
  /** The English phrase this is a word-for-word rendering of. */
  english: string;
  /** How the same thing is normally said in Ukrainian. */
  instead: string;
  /**
   * Worth spending prompt space on.
   *
   * Every rule here is checked after the fact and, for a translation, sent
   * back to be redone — so listing one in the prompt buys only the chance of
   * avoiding that round trip. Measured over 141k reviewed lines, seven of
   * these idioms account for fewer than twenty hits between them: naming them
   * costs every request and saves almost none. Those stay out of the prompt,
   * covered by the general "translate the idiom, not the words" rule, and are
   * caught by the detector on the rare occasion they appear.
   */
  inPrompt: boolean;
};

const CALQUE_RULES: readonly UkCalqueRule[] = [
  {
    // Ukrainian has no tag question of the English kind; it uses a particle.
    id: 'tag_question',
    inPrompt: true,
    pattern: /(?<![\p{L}\p{N}_])чи\s+не\s+так\s*\?/iu,
    english: "isn't it? / right?",
    instead: '«так?», «еге ж?», «правда?» або без хвостика взагалі',
  },
  {
    // «У нас є вода», «на це є дві причини», «як воно є зараз» are all the verb
    // of existence and stay. Two things separate the English copula from it:
    // an instrumental complement, which existential «є» never takes («він є
    // членом»), or a subject pronoun opening the clause («Це є пастка») — in
    // the existential reading that pronoun always carries a preposition or a
    // conjunction in front of it instead.
    id: 'copula_ye',
    inPrompt: true,
    pattern:
      /(?<![\p{L}\p{N}_])(?:я|ти|він|вона|воно|ми|ви|вони|це)\s+є\s+\p{L}+(?:ом|ем|єм|ою|ею|єю|ами|ями)(?![\p{L}\p{N}_])|(?<=^|[.!?…\n"«»,;:—–-]\s{0,3})(?:я|ти|він|вона|воно|ми|ви|вони|це)\s+є\s+(?!(?:в|у|на|до|з|із|за|про|тут|там|ще|вже|лише|тільки|завжди|скрізь|коли|де|що|чим|ким)(?![\p{L}\p{N}_]))\p{L}/iu,
    english: 'I am / it is (explicit copula)',
    instead: 'без «є»: «Він — член загону», «Це пастка»',
  },
  {
    id: 'appreciate_it',
    inPrompt: true,
    pattern: /(?<![\p{L}\p{N}_])ціную\s+це(?![\p{L}\p{N}_])/iu,
    english: 'I appreciate it',
    instead: '«Дякую», «Дякую за це», «Це багато значить»',
  },
  {
    id: 'take_care_of',
    inPrompt: false,
    pattern: /(?<![\p{L}\p{N}_])взя(?:ти|в|ла|ли)\s+турботу\s+про(?![\p{L}\p{N}_])/iu,
    english: 'take care of',
    instead: '«подбати про», «залагодити», «розібратися з»',
  },
  {
    id: 'make_a_difference',
    inPrompt: false,
    pattern: /(?<![\p{L}\p{N}_])зроби(?:ти|в|ла|ли)\s+різницю(?![\p{L}\p{N}_])/iu,
    english: 'make a difference',
    instead: '«щось змінити», «мати значення»',
  },
  {
    // Literal «у кінці дня ми повернемось» is fine; the figurative sense is not.
    id: 'end_of_the_day',
    inPrompt: false,
    pattern:
      /(?<![\p{L}\p{N}_])у?\s*кінці\s+дня(?![\p{L}\p{N}_])(?!\s*(?:ми|вони|я|ти|ви)\s+(?:поверн|прийд|закінч|виру))/iu,
    english: 'at the end of the day (figurative)',
    instead: '«зрештою», «врешті-решт»',
  },
  {
    id: 'up_to_you',
    inPrompt: false,
    pattern: /(?<![\p{L}\p{N}_])це\s+залежить\s+(?:лише\s+)?від\s+(?:тебе|вас)(?![\p{L}\p{N}_])/iu,
    english: "it's up to you",
    instead: '«Тобі вирішувати», «Вам вирішувати», «Як скажеш»',
  },
  {
    id: 'are_you_okay',
    inPrompt: true,
    pattern: /(?<![\p{L}\p{N}_])(?:ти|ви)\s+в\s+порядку(?![\p{L}\p{N}_])/iu,
    english: 'are you okay?',
    instead: '«Усе гаразд?», «Ціл(ий/а)?», «Живий?»',
  },
  {
    // «У тебе немає проблем» is a statement about problems and is correct. The
    // calque is the whole-utterance reply to a thank-you, so the phrase has to
    // stand alone as its own sentence to count.
    id: 'no_problem',
    inPrompt: false,
    pattern: /(?<=^|[.!?…\n"«])\s*(?:та\s+|ну\s+)?немає\s+проблем\s*[.!?…]/iu,
    english: 'no problem (as a reply)',
    instead: '«Нема за що», «Без проблем», «Та пусте»',
  },
  {
    id: 'do_not_worry_about_it',
    inPrompt: false,
    pattern: /(?<![\p{L}\p{N}_])не\s+(?:хвилюйся|турбуйся)\s+про\s+це(?![\p{L}\p{N}_])/iu,
    english: "don't worry about it",
    instead: '«Пусте», «Забудь», «Нічого страшного»',
  },
  {
    id: 'hang_in_there',
    inPrompt: false,
    pattern: /(?<![\p{L}\p{N}_])тримайся\s+там(?![\p{L}\p{N}_])/iu,
    english: 'hang in there',
    instead: '«Тримайся», «Не здавайся»',
  },
];

export type UkCalqueMatch = {
  rule: UkCalqueRule;
  /** The exact text that matched, for the QA message. */
  match: string;
};

/** Every calque rule the text trips. */
export const findUkrainianCalques = (text: string): UkCalqueMatch[] => {
  if (!text.trim()) return [];

  const found: UkCalqueMatch[] = [];
  for (const rule of CALQUE_RULES) {
    const match = rule.pattern.exec(text);
    if (match) found.push({ rule, match: match[0].trim() });
  }
  return found;
};

/** One reviewer-facing line naming what was found and what to say instead. */
export const describeUkrainianCalques = (matches: readonly UkCalqueMatch[]): string =>
  matches
    .map(({ rule, match }) => `«${match}» — калька з "${rule.english}"; природніше ${rule.instead}`)
    .join('; ');

/** Every rule, in the order they are checked. */
export const ukrainianCalqueRules = (): readonly UkCalqueRule[] => CALQUE_RULES;

/** The subset worth naming in a prompt — see {@link UkCalqueRule.inPrompt}. */
export const promptCalqueRules = (): readonly UkCalqueRule[] =>
  CALQUE_RULES.filter((rule) => rule.inPrompt);
