/** Combining acute used for Ukrainian lexical stress marks (TTS). */
export const STRESS_COMBINING_ACUTE = '\u0301';

/** Row fields needed to resolve TTS / UI stressed text. */
export type StressedTranslationFields = {
  translation: string;
  textStressed?: string | null;
  stressSrcText?: string | null;
};

/** Remove U+0301 stress marks; NFC-normalize so comparisons are stable. */
export const stripStressMarks = (text: string): string =>
  text.normalize('NFC').split(STRESS_COMBINING_ACUTE).join('');

/**
 * True when stressed text is the source with only U+0301 marks added
 * (no spelling / wording drift from the LLM).
 */
export const stressedMatchesSource = (stressed: string, source: string): boolean =>
  stripStressMarks(stressed) === stripStressMarks(source);

/**
 * Stressed text is usable only when it still matches the current translation:
 * snapshot (`stressSrcText`) and letter-for-letter content (sans stress marks).
 */
export const isStressedTranslationCurrent = (row: StressedTranslationFields): boolean => {
  const stressed = row.textStressed?.trim();
  if (!stressed) return false;
  const src = row.stressSrcText ?? '';
  if (src !== row.translation) return false;
  return stressedMatchesSource(stressed, row.translation);
};

/**
 * Stressed text is valid only while it matches the current translation snapshot
 * and does not rewrite the underlying letters. Returns null when absent, empty,
 * stale after a translation edit, or drifted by stress-placement.
 */
export const effectiveStressedTranslation = (row: StressedTranslationFields): string | null => {
  if (!isStressedTranslationCurrent(row)) return null;
  return row.textStressed!.trim();
};
