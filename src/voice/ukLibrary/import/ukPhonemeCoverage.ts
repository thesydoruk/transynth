/**
 * Soft preference for Ukrainian-distinctive graphemes in reference transcripts.
 * Fish Speech benefits from hearing rolled /r/ and letters rare in other languages
 * (и, ї, є, ґ, щ) — but this must never override a clearly better acoustic clip.
 */

/** Letters with especially distinctive Ukrainian sound / orthography. */
const UK_DISTINCT_LETTERS = new Set(['р', 'и', 'ї', 'є', 'ґ', 'щ']);

/** Max additive points on top of acoustic qualityScore (0–100). */
export const UK_PHONEME_QUALITY_BONUS_MAX = 6;

/**
 * 0–1 coverage of Ukrainian-distinctive letters in a transcript.
 * Heavily weights «р» (target ~3), then diversity of {р,и,ї,є,ґ,щ}.
 */
export const scoreUkPhonemeCoverage = (text: string | null | undefined): number => {
  const raw = (text ?? '').toLocaleLowerCase('uk');
  const letters = [...raw].filter((ch) => /[а-яіїєґ]/u.test(ch));
  if (letters.length < 8) return 0;

  let rCount = 0;
  const present = new Set<string>();
  for (const ch of letters) {
    if (ch === 'р') rCount += 1;
    if (UK_DISTINCT_LETTERS.has(ch)) present.add(ch);
  }

  // Soft saturation: 0 р → 0; 3+ р → 1. Avoid rewarding endless «ррр».
  const rScore = Math.min(1, rCount / 3);
  const coverageScore = present.size / UK_DISTINCT_LETTERS.size;
  return Math.max(0, Math.min(1, 0.6 * rScore + 0.4 * coverageScore));
};

/** Small quality bonus (0–{@link UK_PHONEME_QUALITY_BONUS_MAX}) from transcript phonemes. */
export const ukPhonemeQualityBonus = (text: string | null | undefined): number =>
  scoreUkPhonemeCoverage(text) * UK_PHONEME_QUALITY_BONUS_MAX;

/** Acoustic quality plus capped phoneme bonus for final winner selection. */
export const blendUkReferenceScore = (
  qualityScore: number,
  transcript: string | null | undefined,
): number => qualityScore + ukPhonemeQualityBonus(transcript);
