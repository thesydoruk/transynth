import { parseSpeakerGender, type SpeakerGender } from './gender';

/** Narrator gender for BOOK/TERM/NOTE records (includes neutral third-person text). */
export type NarratorGender = SpeakerGender | 'neutral';

const NARRATOR_GENDERS: readonly NarratorGender[] = ['male', 'female', 'neutral', 'any', 'unknown'];

export type NarratorGenderSource = 'llm' | 'heuristic' | 'manual' | 'edid';

export const NARRATIVE_RECORD_SIGNATURES = ['BOOK', 'TERM', 'NOTE'] as const;

/** Body subrecords that may carry first-person narrative. */
export const NARRATIVE_PATH_SUFFIXES = ['UNAM', 'DESC', 'CNAM'] as const;

export const GENDER_DETECT_SOURCE_EXCERPT_MAX = 2000;

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

/** Map narrator gender to LLM speaker_gender (neutral/unknown → omit). */
export const narratorToSpeakerGender = (
  gender: NarratorGender | null | undefined,
): SpeakerGender | null => {
  const parsed = parseNarratorGender(gender);
  if (parsed === 'male' || parsed === 'female') return parsed;
  return null;
};

export const isNarrativeRecordPath = (signature: string | null, path: string | null): boolean => {
  if (
    !signature ||
    !NARRATIVE_RECORD_SIGNATURES.includes(signature as (typeof NARRATIVE_RECORD_SIGNATURES)[number])
  ) {
    return false;
  }
  if (!path) return false;
  const tail = path.split('\\').pop()?.toUpperCase() ?? '';
  return NARRATIVE_PATH_SUFFIXES.includes(tail as (typeof NARRATIVE_PATH_SUFFIXES)[number]);
};
