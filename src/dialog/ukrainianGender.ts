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
  'би',
  'б',
  'ж',
  'же',
  'й',
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

const WORD_RE = /[а-яіїєґёa-z'’]+/gi;
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
  if (NOT_FEMININE_VERBS.has(token) || NOT_MASCULINE_VERBS.has(token)) return null;

  if (token.length >= 5 && (token.endsWith('лася') || token.endsWith('лась'))) return 'female';
  if (token.length >= 4 && token.endsWith('ла')) return 'female';
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
 * Scanning starts at each pronoun and walks forward over fillers only, so
 * «я вже сказала» is inspected while «я на острів» is not: the preposition
 * ends the scan before the noun can be mistaken for a past-tense verb.
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

    for (let j = k + 1; j < wordIdx.length; j++) {
      if (punctBetween(anchorPiece, wordIdx[j]!)) break;
      const token = wordAt(j);
      if (FILLERS.has(token)) continue;
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

  for (const marker of markers) {
    const role = marker.person === 1 ? 'speaker' : 'addressee';
    const expected =
      marker.person === 1 ? participants.speakerGender : participants.addresseeGender;
    if (!conflictsWith(expected, marker.gender)) continue;
    conflicts.push({ role, expected, found: marker.gender, form: marker.form });
  }

  return conflicts;
};
