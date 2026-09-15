/**
 * Detection of gendered Ukrainian wording in a translation.
 *
 * Ukrainian marks gender on past-tense verbs and predicative adjectives, so
 * «я був» and «я була» are both valid renderings of "I was" and only the
 * speaker's gender decides which one is correct. English source text never
 * carries that information, which makes this the single most common class of
 * error in machine-translated dialog.
 *
 * The detector is deliberately narrow: a gendered form only counts when it sits
 * next to a first- or second-person pronoun, because that is the only position
 * where the form has to agree with a dialog participant rather than with some
 * other noun in the sentence.
 */
import type { SpeakerGender } from './gender';

/** Words that may sit between a pronoun and its verb without breaking agreement. */
const FILLERS = new Set([
  'не',
  'вже',
  'ще',
  'тільки',
  'щойно',
  'просто',
  'завжди',
  'ніколи',
  'теж',
  'також',
  'саме',
  'справді',
  'дійсно',
  'майже',
  'ледь',
  'зовсім',
  'навіть',
  'колись',
  'тоді',
  'таки',
  'мабуть',
  'напевно',
  'аж',
  'би',
  'б',
  'ж',
  'же',
  'й',
]);

/**
 * Prepositions that open a short PP before the verb («я до цього звик»).
 * After one of these the next content word must be an anaphor, not a noun:
 * otherwise «я на острів» / «я про старий світ» would be misread.
 */
const PREPOSITIONS = new Set([
  'до',
  'з',
  'зі',
  'із',
  'про',
  'на',
  'у',
  'в',
  'за',
  'під',
  'над',
  'при',
  'через',
  'після',
  'перед',
  'для',
  'без',
  'від',
  'об',
  'о',
]);

/**
 * Object pronouns and demonstratives that sit between «я/ти» and the verb.
 * «Я це бачив», «я їй сказав», «я до цього звик».
 */
const BRIDGES = new Set([
  'це',
  'те',
  'цей',
  'ця',
  'ці',
  'той',
  'та',
  'ті',
  'цього',
  'цьому',
  'цим',
  'цією',
  'цієї',
  'цій',
  'цих',
  'цими',
  'того',
  'тому',
  'тим',
  'тією',
  'тієї',
  'тій',
  'тих',
  'тими',
  'таке',
  'такий',
  'така',
  'такі',
  'такого',
  'такому',
  'таким',
  'такої',
  'такій',
  'такою',
  'все',
  'усе',
  'всього',
  'усього',
  'всьому',
  'усьому',
  'всім',
  'усім',
  'мене',
  'мені',
  'мною',
  'тебе',
  'тобі',
  'тобою',
  'його',
  'йому',
  'ним',
  'нього',
  'ньому',
  'її',
  'їй',
  'нею',
  'неї',
  'ній',
  'нас',
  'нам',
  'нами',
  'вас',
  'вам',
  'вами',
  'їх',
  'їм',
  'ними',
  'них',
  'себе',
  'собі',
  'собою',
]);

const FIRST_PERSON_ANCHORS = new Set(['я']);
/** Only nominative «ти» — «тебе/тобі» are objects, so nearby verbs agree with the speaker. */
const SECOND_PERSON_ANCHORS = new Set(['ти']);

const MASCULINE_PREDICATIVES = new Set([
  'готовий',
  'готов',
  'впевнений',
  'упевнений',
  'певен',
  'певний',
  'радий',
  'сам',
  'винен',
  'винний',
  'повинен',
  'змушений',
  'здивований',
  'живий',
  'мертвий',
  'вільний',
  'зайнятий',
  'голодний',
  'втомлений',
  'щасливий',
  'злий',
  'хворий',
  "п'яний",
  'серйозний',
  'обережний',
  'задоволений',
  'розчарований',
  'наляканий',
  'поранений',
  'один',
  'сильний',
  'слабкий',
  'старий',
  'молодий',
]);

const FEMININE_PREDICATIVES = new Set([
  'готова',
  'впевнена',
  'упевнена',
  'певна',
  'рада',
  'сама',
  'винна',
  'повинна',
  'змушена',
  'здивована',
  'жива',
  'мертва',
  'вільна',
  'зайнята',
  'голодна',
  'втомлена',
  'щаслива',
  'зла',
  'хвора',
  "п'яна",
  'серйозна',
  'обережна',
  'задоволена',
  'розчарована',
  'налякана',
  'поранена',
  'одна',
  'сильна',
  'слабка',
  'стара',
  'молода',
]);

/** Feminine nouns and adverbs that end in «в» and would trip the past-tense rule. */
const NOT_MASCULINE_VERBS = new Set([
  'кров',
  'любов',
  'знов',
  'морков',
  'церков',
  'лев',
  'рів',
  'острів',
  'гнів',
  'рукав',
  'нерв',
  'архів',
  'мотив',
  'масив',
  'справ',
  'кооператив',
  'детектив',
  'довкола',
]);

/**
 * Masculine past-tense verbs that do not end in «в» («звик», «міг», «ліг»).
 * Feminine counterparts still match the regular «-ла» rule.
 */
const MASCULINE_IRREGULAR_PAST = new Set([
  'звик',
  'відвик',
  'привик',
  'міг',
  'зміг',
  'допоміг',
  'переміг',
  'ліг',
  'поліг',
  'заліз',
  'виліз',
  'поліз',
  'проліз',
  'ніс',
  'приніс',
  'поніс',
  'відніс',
  'виніс',
  'заніс',
  'віз',
  'привіз',
  'перевіз',
  'відвіз',
  'вивіз',
  'ріс',
  'виріс',
  'підріс',
]);

/** Nouns that end in «ла» and would trip the past-tense rule. */
const NOT_FEMININE_VERBS = new Set([
  'сила',
  'стріла',
  'бджола',
  'смола',
  'імла',
  'зола',
  'метла',
  'школа',
  'акула',
  'пила',
  'скала',
  'діла',
  'правила',
  'тіла',
  'крісла',
]);

/**
 * Genitive-plural nouns ending in «-ів/-їв» that sit before «я» in game text
 * («через синтів я…») and must not be read as inverted past-tense verbs.
 * Real inverted «Хотів я…» is rare enough in dialog to ignore.
 */
const looksLikeGenitivePlural = (token: string): boolean =>
  token.length >= 4 && (token.endsWith('ів') || token.endsWith('їв'));

/** Split so we can see punctuation between a candidate verb and its pronoun. */
const TOKEN_RE = /[а-яіїєґёa-z'’]+|[^а-яіїєґёa-z'’\s]+/gi;

/** One gendered form found next to a participant pronoun. */
export type UkGenderMarker = {
  gender: 'male' | 'female';
  /** 1 — the speaker describes themselves; 2 — they describe the addressee. */
  person: 1 | 2;
  form: string;
};

const classifyForm = (token: string): 'male' | 'female' | null => {
  if (FEMININE_PREDICATIVES.has(token)) return 'female';
  if (MASCULINE_PREDICATIVES.has(token)) return 'male';
  if (MASCULINE_IRREGULAR_PAST.has(token)) return 'male';
  if (NOT_FEMININE_VERBS.has(token) || NOT_MASCULINE_VERBS.has(token)) return null;

  if (token.length >= 5 && (token.endsWith('лася') || token.endsWith('лась'))) return 'female';
  if (token.length >= 4 && token.endsWith('ла')) return 'female';
  // Right after the pronoun an adjective is predicative, so «ти перший»,
  // «ти єдиний» and «ти інший» pin the addressee down as surely as a verb.
  if (token.length >= 5 && (token.endsWith('ий') || token.endsWith('ій'))) return 'male';
  if (token.length >= 4 && (token.endsWith('вся') || token.endsWith('всь'))) return 'male';
  if (token.length >= 3 && token.endsWith('в')) return 'male';

  return null;
};

const anchorPerson = (token: string): 1 | 2 | null => {
  if (FIRST_PERSON_ANCHORS.has(token)) return 1;
  if (SECOND_PERSON_ANCHORS.has(token)) return 2;
  return null;
};

/**
 * Find gendered forms that must agree with a dialog participant.
 *
 * Scanning starts at each pronoun and walks forward over fillers, object
 * pronouns and a short «prep + anaphor» PP, so «я вже сказала» and
 * «я до цього звик» are inspected. A preposition followed by a noun
 * («я на острів», «я про старий світ») still ends the scan: the complement
 * is not an anaphor, so it is not read as a past-tense verb.
 */
const isWordToken = (value: string): boolean => /^[а-яіїєґёa-z'’]+$/i.test(value);

export const detectUkrainianGenderMarkers = (text: string): UkGenderMarker[] => {
  const raw = text.toLowerCase().match(TOKEN_RE) ?? [];
  type Piece = { kind: 'word' | 'other'; value: string };
  const pieces: Piece[] = raw.map((value) => ({
    kind: isWordToken(value) ? 'word' : 'other',
    value,
  }));

  const wordIdx: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i]!.kind === 'word') wordIdx.push(i);
  }

  const markers: UkGenderMarker[] = [];
  const seen = new Set<string>();

  const push = (person: 1 | 2, gender: 'male' | 'female', form: string): void => {
    const key = `${person}:${gender}:${form}`;
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ person, gender, form });
  };

  const wordAt = (k: number): string => pieces[wordIdx[k]!]!.value;

  const punctBetween = (pieceA: number, pieceB: number): boolean => {
    const lo = Math.min(pieceA, pieceB);
    const hi = Math.max(pieceA, pieceB);
    for (let i = lo + 1; i < hi; i++) {
      if (pieces[i]!.kind === 'other' && /[.!?…,;:]/.test(pieces[i]!.value)) return true;
    }
    return false;
  };

  for (let k = 0; k < wordIdx.length; k++) {
    const person = anchorPerson(wordAt(k));
    if (person == null) continue;
    const anchorPiece = wordIdx[k]!;

    let mustBridge = false;
    for (let j = k + 1; j < wordIdx.length; j++) {
      if (punctBetween(anchorPiece, wordIdx[j]!)) break;
      const token = wordAt(j);
      if (FILLERS.has(token)) continue;
      if (PREPOSITIONS.has(token)) {
        mustBridge = true;
        continue;
      }
      if (BRIDGES.has(token)) {
        mustBridge = false;
        continue;
      }
      if (mustBridge) break;
      const gender = classifyForm(token);
      if (gender) push(person, gender, token);
      break;
    }

    if (k > 0) {
      const prevPiece = wordIdx[k - 1]!;
      const previous = wordAt(k - 1);
      if (
        anchorPerson(previous) == null &&
        !punctBetween(prevPiece, anchorPiece) &&
        !looksLikeGenitivePlural(previous)
      ) {
        const gender = classifyForm(previous);
        if (gender) push(person, gender, previous);
      }
    }
  }

  return markers;
};

/**
 * Verbs whose masculine past ends in -ів.
 *
 * That ending is otherwise the genitive plural of a noun — «синтів», «років»,
 * «доказів» — and in the production corpus it is nominal in 361 of 372 distinct
 * words. So for a clause with no pronoun to lean on, the handful of verbs are
 * listed rather than guessed at.
 */
const MASCULINE_PAST_IV = new Set([
  'хотів',
  'захотів',
  'розхотів',
  'зрозумів',
  'розумів',
  'умів',
  'зумів',
  'волів',
  'сидів',
  'летів',
  'злетів',
  'горів',
  'згорів',
  'терпів',
  'стерпів',
  'розповів',
  'повів',
  'зустрів',
  'збожеволів',
  'накоїв',
]);

/** Words that may open a clause before an elided subject's predicate. */
const CLAUSE_OPENERS = new Set([
  'що',
  'щоб',
  'бо',
  'коли',
  'якщо',
  'хоч',
  'хоча',
  'поки',
  'доки',
  'адже',
  'тож',
  'отже',
  'і',
  'й',
  'а',
  'але',
  'та',
  'чи',
  'як',
  'де',
  'куди',
  'звідки',
  'наче',
  'ніби',
  'мовби',
]);

/** Object and oblique forms: present in a clause, but never its subject. */
const OBLIQUE_FORMS = new Set([
  'мене',
  'мені',
  'мною',
  'тебе',
  'тобі',
  'тобою',
  'його',
  'йому',
  'нього',
  'ним',
  'її',
  'їй',
  'неї',
  'нею',
  'їх',
  'їм',
  'них',
  'ними',
  'нас',
  'нам',
  'вас',
  'вам',
  'себе',
  'собі',
  'собою',
  'нікого',
  'нікому',
  'ніким',
  'нічого',
  'нічому',
  'нічим',
  'когось',
  'комусь',
  'чогось',
  'чомусь',
  'щось',
  'хтось',
  'дещо',
  'усе',
  'усього',
  'усім',
  'всього',
  'всім',
  'усіх',
  'всіх',
]);

// Bare -ов and -ев are surnames far more often than verbs («Петров», «Женев»),
// but -шов is the past of every йти verb: знайшов, прийшов, пішов, вийшов.
const MASCULINE_PAST_TAILS = ['ав', 'ив', 'ув', 'яв', 'шов'];

/**
 * A masculine past-tense or predicative form, judged without a pronoun to lean
 * on — so stricter than {@link classifyForm}, which has an anchor to trust.
 * The -ов / -ев tails are left out: as verbs they are rare, and they collide
 * with surnames the game is full of.
 */
const looksLikeMasculineUnanchored = (token: string): boolean => {
  if (NOT_MASCULINE_VERBS.has(token)) return false;
  if (MASCULINE_PREDICATIVES.has(token)) return true;
  if (MASCULINE_IRREGULAR_PAST.has(token)) return true;
  if (token.length >= 5 && (token.endsWith('вся') || token.endsWith('всь'))) return true;
  if (token.length < 4 || !token.endsWith('в')) return false;
  if (token.endsWith('ів') || token.endsWith('їв')) return MASCULINE_PAST_IV.has(token);
  return MASCULINE_PAST_TAILS.some((tail) => token.endsWith(tail));
};

/**
 * The feminine counterpart. Bare -ла is left out on purpose: «сила», «правила»,
 * «джерела» and a genitive «Ерла» all end that way, and with no pronoun there is
 * nothing to tell them from a verb. The reflexive -лася / -лась has no such
 * collision, and the named predicatives are unambiguous.
 */
const looksLikeFeminineUnanchored = (token: string): boolean => {
  if (NOT_FEMININE_VERBS.has(token)) return false;
  if (FEMININE_PREDICATIVES.has(token)) return true;
  return token.length >= 4 && (token.endsWith('ла') || token.endsWith('лась'));
};

const unanchoredGender = (token: string): 'male' | 'female' | null => {
  if (looksLikeMasculineUnanchored(token)) return 'male';
  if (looksLikeFeminineUnanchored(token)) return 'female';
  return null;
};

/** A gendered form in a clause whose subject was left out. */
export type UkUnanchoredMarker = { gender: 'male' | 'female'; form: string };

const SENTENCE_SPLIT_RE = /[.!?…\n]+/u;
const CLAUSE_SPLIT_RE = /[,;:—–()"«»]+/u;
const CLAUSE_WORD_RE = /[а-яіїєґёa-z'’]+/gu;

/** Infinitives and adverbs are never the subject the predicate agrees with. */
const isInfinitive = (token: string): boolean =>
  token.length >= 4 && (token.endsWith('ти') || token.endsWith('ть') || token.endsWith('тися'));

/**
 * A finite verb or an oblique noun — either way, not the subject a predicate
 * agrees with. A Ukrainian nominative ends in a consonant or in -а / -я, so a
 * word ending in -у / -ю is an object or a verb: «Дякую, що сказав», «Зброю
 * знайшов». Without this the first verb of a sentence is mistaken for its
 * subject and the clause after it is never looked at.
 */
const isNotSubjectShape = (token: string): boolean =>
  token.length >= 3 &&
  (token.endsWith('у') ||
    token.endsWith('ю') ||
    token.endsWith('еш') ||
    token.endsWith('єш') ||
    token.endsWith('иш') ||
    token.endsWith('їш'));

/** Words that may stand before the predicate without being its subject. */
const isSubjectless = (token: string): boolean =>
  FILLERS.has(token) ||
  CLAUSE_OPENERS.has(token) ||
  OBLIQUE_FORMS.has(token) ||
  isNotSubjectShape(token);

/**
 * Gendered predicates in clauses that name no subject at all.
 *
 * Ukrainian drops the subject pronoun constantly — «Зрозумів.», «Не впевнений.»,
 * «Ще нікого не знайшов.» — and the anchored scan, which needs «я» or «ти» beside
 * the form, cannot see any of it. Measured against this project's own hand-written
 * leak examples, that blind spot was most of what the detector missed.
 *
 * Three things have to hold before a form counts, each of them a false positive
 * found on the production corpus:
 *
 * - nothing before it in the clause could be a subject, or «Ерл був мертвий»
 *   reads as a leak;
 * - nothing bare follows it either, because Ukrainian puts the subject after the
 *   verb as readily as before it — «Чи знищив Інститут Підземку?», «що сказав би
 *   синт» — and the same test throws out the attributive reading of «старий
 *   Денні» and «ще один робот»;
 * - no earlier clause in the same sentence introduced a subject, or the relative
 *   clause in «Він привів тебе до нас, бо знав» is read as subjectless when it
 *   is plainly about him.
 */
export const detectUnanchoredGenderForms = (text: string): UkUnanchoredMarker[] => {
  const markers: UkUnanchoredMarker[] = [];
  const seen = new Set<string>();

  for (const sentence of text.toLowerCase().split(SENTENCE_SPLIT_RE)) {
    for (const clause of sentence.split(CLAUSE_SPLIT_RE)) {
      const tokens = clause.match(CLAUSE_WORD_RE) ?? [];
      let index = 0;
      while (index < tokens.length && isSubjectless(tokens[index]!)) index++;

      const candidate = tokens[index];
      if (candidate == null) continue;
      const gender = unanchoredGender(candidate);
      // A content word that is not a predicate is a subject this sentence now
      // has, and every clause after it may be speaking about that subject.
      if (!gender) break;

      const rest = tokens.slice(index + 1);
      let governed = false;
      const subjectAfter = rest.some((token) => {
        if (PREPOSITIONS.has(token)) {
          governed = true;
          return false;
        }
        if (isSubjectless(token) || isInfinitive(token)) return false;
        if (governed) {
          governed = false;
          return false;
        }
        return true;
      });
      if (subjectAfter) break;

      if (!seen.has(`${gender}:${candidate}`)) {
        seen.add(`${gender}:${candidate}`);
        markers.push({ gender, form: candidate });
      }
    }
  }

  return markers;
};

/**
 * Which participant an elided subject could belong to without leaking.
 *
 * A role can own a masculine form if it is male, or if nobody knows its gender.
 * A role the player chooses (`any`) never can. So the form is only reported when
 * no role could own it and at least one of them is the player's — the one case
 * where the wording is wrong however the line is read.
 */
const unanchoredConflictRole = (
  gender: 'male' | 'female',
  participants: { speakerGender: SpeakerGender; addresseeGender: SpeakerGender },
): 'speaker' | 'addressee' | null => {
  const canOwn = (role: SpeakerGender): boolean => role === 'unknown' || role === gender;
  if (canOwn(participants.speakerGender) || canOwn(participants.addresseeGender)) return null;
  if (participants.speakerGender === 'any') return 'speaker';
  if (participants.addresseeGender === 'any') return 'addressee';
  return null;
};

/** A gendered form that contradicts the known gender of a dialog participant. */
export type UkGenderConflict = {
  /** Participant the form disagrees with. */
  role: 'speaker' | 'addressee';
  expected: SpeakerGender;
  found: 'male' | 'female';
  form: string;
};

const conflictsWith = (expected: SpeakerGender, found: 'male' | 'female'): boolean => {
  if (expected === 'any') return true;
  if (expected === 'male' || expected === 'female') return expected !== found;
  return false;
};

/**
 * Compare the gendered wording of a translation against the known participants.
 *
 * An `any` gender always conflicts: the player picks their gender in-game, so
 * any committed form is wrong for half the players.
 */
export const findUkrainianGenderConflicts = (
  translation: string,
  participants: { speakerGender: SpeakerGender; addresseeGender: SpeakerGender },
): UkGenderConflict[] => {
  const markers = detectUkrainianGenderMarkers(translation);
  const conflicts: UkGenderConflict[] = [];

  const reported = new Set<string>();

  for (const marker of markers) {
    const role = marker.person === 1 ? 'speaker' : 'addressee';
    const expected =
      marker.person === 1 ? participants.speakerGender : participants.addresseeGender;
    if (!conflictsWith(expected, marker.gender)) continue;
    reported.add(marker.form);
    conflicts.push({ role, expected, found: marker.gender, form: marker.form });
  }

  for (const marker of detectUnanchoredGenderForms(translation)) {
    if (reported.has(marker.form)) continue;
    const role = unanchoredConflictRole(marker.gender, participants);
    if (!role) continue;
    reported.add(marker.form);
    conflicts.push({ role, expected: 'any', found: marker.gender, form: marker.form });
  }

  return conflicts;
};
