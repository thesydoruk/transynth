/**
 * Fallout 4's one-word tone prompts on the dialogue wheel.
 *
 * Taken from the reviewed corpus (2026-10-24), not chosen by hand: the one-word
 * `INFO\RNAM` prompts that occur at least ten times and are written as a
 * bracketed remark in at least 90% of reviewed lines. "Unsure", "Neutral",
 * "Curious" and the like are left out — reviewers wrote them both ways because
 * the same word is sometimes an answer ("Ще не ясно") and sometimes a tone.
 */
export const FO4_TONE_TAG_PROMPTS: readonly string[] = [
  'Sarcastic',
  'Impatient',
  'Annoyed',
  'Cocky',
  'Confident',
  'Evasive',
  'Friendly',
];
