/** Row fields needed to resolve TTS / UI stressed text. */
export type StressedTranslationFields = {
  translation: string;
  textStressed?: string | null;
  stressSrcText?: string | null;
};

/**
 * Stressed text is valid only while it matches the current translation snapshot.
 * Returns null when absent, empty, or stale after a translation edit.
 */
export const effectiveStressedTranslation = (row: StressedTranslationFields): string | null => {
  const stressed = row.textStressed?.trim();
  if (!stressed) return null;
  const src = row.stressSrcText ?? '';
  if (src !== row.translation) return null;
  return stressed;
};
