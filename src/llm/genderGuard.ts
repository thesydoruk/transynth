/**
 * Catch a translation that commits to a gender the dialog metadata forbids.
 *
 * Ukrainian marks gender on past-tense verbs and predicative adjectives, so a
 * line spoken by — or to — the player character has to be phrased so it reads
 * correctly whichever gender the player picked. A model asked to do that gets
 * it right most of the time and quietly defaults to masculine the rest of the
 * time, which no amount of prompt wording removes entirely.
 *
 * The same detector that powers the QA check runs here, at the two points
 * where a wrong line can still be stopped: right after the translation is
 * produced, and before a verify verdict calls it fine.
 */
import { findUkrainianGenderConflicts, parseSpeakerGender, type UkGenderConflict } from '../dialog';
import type { LlmDialogParticipants } from './dialogParticipants';

/** The only target language whose morphology the detector understands. */
const GENDER_GUARD_TARGET_LANG = 'uk';

export const isGenderGuardLanguage = (targetLang: string | null | undefined): boolean =>
  targetLang?.trim().toLowerCase() === GENDER_GUARD_TARGET_LANG;

/**
 * Gendered forms in `translation` that contradict the participants of the line.
 * Empty when the line is fine, the language is not Ukrainian, or the metadata
 * says nothing to contradict.
 */
export const findGenderLeaks = (
  translation: string,
  item: LlmDialogParticipants,
  targetLang: string | null | undefined,
): UkGenderConflict[] => {
  if (!isGenderGuardLanguage(targetLang) || !translation.trim()) return [];

  return findUkrainianGenderConflicts(translation, {
    speakerGender: parseSpeakerGender(item.speaker_gender),
    addresseeGender: parseSpeakerGender(item.addressee_gender),
  });
};

const ROLE_LABEL: Record<UkGenderConflict['role'], string> = {
  speaker: 'мовця',
  addressee: 'адресата',
};

/** One line of feedback naming the offending forms and what they should respect. */
export const describeGenderLeaks = (conflicts: readonly UkGenderConflict[]): string => {
  const parts = conflicts.map((conflict) => {
    const forms = `«${conflict.form}»`;
    if (conflict.expected === 'any') {
      return `${forms} закріплює ${conflict.found === 'female' ? 'жіночий' : 'чоловічий'} рід ${ROLE_LABEL[conflict.role]}, хоч його обирає гравець`;
    }
    return `${forms} не збігається зі статтю ${ROLE_LABEL[conflict.role]} (${conflict.expected})`;
  });
  return `Рід: ${[...new Set(parts)].join('; ')}.`;
};

/**
 * Instruction handed back to the model when a line has to be redone.
 *
 * Names the exact forms rather than repeating the general rule: the general
 * rule was already in the prompt and did not take.
 */
export const genderRetryInstruction = (conflicts: readonly UkGenderConflict[]): string =>
  `${describeGenderLeaks(conflicts)} Перепиши присудок так, щоб рід не читався: теперішній час, наказ, безособове або іменник. Не міняй рід на протилежний, не став слеш і не ховай рід через «ви».`;

/**
 * True when every objection is about a gender the player picks.
 *
 * The two kinds of failure want opposite repairs. A line addressed to, or
 * spoken by, the player must lose its gender; a line whose participant has a
 * known gender must simply agree with it. Telling one pass to do both is how
 * Curie's own log came back as «Завершено аналіз… помічником».
 */
export const isPlayerGenderConflict = (conflicts: readonly UkGenderConflict[]): boolean =>
  conflicts.length > 0 && conflicts.every((conflict) => conflict.expected === 'any');

/** Instruction for a form that simply has to agree with a gender we know. */
export const genderAgreementInstruction = (conflicts: readonly UkGenderConflict[]): string => {
  const parts = conflicts.map(
    (conflict) =>
      `«${conflict.form}» → ${conflict.expected === 'female' ? 'жіночий' : 'чоловічий'} рід (${
        conflict.role === 'speaker' ? 'мовець' : 'адресат'
      } — ${conflict.expected})`,
  );
  return `Рід не збігається: ${[...new Set(parts)].join('; ')}. Заміни закінчення на правильний рід. Не перефразовуй і не ховай рід — стать відома.`;
};
