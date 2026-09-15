import { type SpeakerGender } from './gender';

/** Narrator gender for BOOK/TERM/NOTE records (includes neutral third-person text). */
export type NarratorGender = SpeakerGender | 'neutral';

const NARRATOR_GENDERS: readonly NarratorGender[] = ['male', 'female', 'neutral', 'any', 'unknown'];

export type NarratorGenderSource = 'llm' | 'heuristic' | 'manual' | 'edid';

export const parseNarratorGender = (value: unknown): NarratorGender =>
  typeof value === 'string' && NARRATOR_GENDERS.includes(value as NarratorGender)
    ? (value as NarratorGender)
    : 'unknown';

/** Gender downstream consumers use for a narrative record. */
export const effectiveNarratorGenderSql = (alias: string): string =>
  `COALESCE(
     NULLIF(${alias}.narrator_gender_override, ''),
     NULLIF(${alias}.narrator_gender, ''),
     'unknown'
   )`;

/**
 * Whether a narrative record's gender is solid enough to hold a translation out
 * of review.
 *
 * Every automatic source here is an inference about who wrote a terminal entry
 * or a book, and on the production corpus those inferences are wrong often
 * enough to matter: the heuristic labelled Piper Wright's own article and
 * Curie's log as male. A wrong "expected" gender does more than block a correct
 * line — it invites the repair pass to rewrite it into a wrong one. So a guess
 * stays a hint for the prompt and an advisory note, and only a person's own
 * decision — an override, or a gender set by hand — is treated as fact.
 */
export const isNarratorGenderTrusted = (
  source: string | null | undefined,
  override: string | null | undefined,
): boolean => (override ?? '').trim() !== '' || source === 'manual';

/** Map narrator gender to LLM speaker_gender (neutral/unknown → omit). */
export const narratorToSpeakerGender = (
  gender: NarratorGender | null | undefined,
): SpeakerGender | null => {
  const parsed = parseNarratorGender(gender);
  if (parsed === 'male' || parsed === 'female') return parsed;
  return null;
};
