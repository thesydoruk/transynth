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
]);

const FIRST_PERSON_ANCHORS = new Set(['я']);
const SECOND_PERSON_ANCHORS = new Set(['ти', 'тебе', 'тобі']);

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
]);

const WORD_RE = /[а-яіїєґёa-z'’]+/gi;

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
export const detectUkrainianGenderMarkers = (text: string): UkGenderMarker[] => {
  const tokens = text.toLowerCase().match(WORD_RE) ?? [];
  const markers: UkGenderMarker[] = [];
  const seen = new Set<string>();

  const push = (person: 1 | 2, gender: 'male' | 'female', form: string): void => {
    const key = `${person}:${gender}:${form}`;
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ person, gender, form });
  };

  for (let i = 0; i < tokens.length; i++) {
    const person = anchorPerson(tokens[i]!);
    if (person == null) continue;

    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j]!;
      if (FILLERS.has(token)) continue;
      const gender = classifyForm(token);
      if (gender) push(person, gender, token);
      break;
    }

    const previous = i > 0 ? tokens[i - 1]! : null;
    if (previous && anchorPerson(previous) == null) {
      const gender = classifyForm(previous);
      if (gender) push(person, gender, previous);
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
