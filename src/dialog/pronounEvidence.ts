/**
 * Gender of a speaker, read from how the rest of the mod talks about them.
 *
 * A mod names its voice types after its own characters — `SS2_VT_Lydia`,
 * `SS2_VT_Jake` — which the Creation Kit gender conventions cannot read, and no
 * list of names can either: a character may be a Nord, a Khajiit, or something
 * the author invented last week. But the mod's *English* text almost always
 * gives them away, because English marks gender on the pronoun and the other
 * characters keep referring to them:
 *
 *   "Jake said he'd meet us at the settlement."
 *   "Ask Lydia about it. She was there."
 *
 * So the evidence is counted rather than guessed: occurrences of the name with
 * a gendered pronoun nearby, in the source language, across the whole mod. A
 * clear majority decides; anything close stays `unknown`, which downstream
 * means "write the line so the gender does not show".
 */
import type { SpeakerGender } from './gender';

/** Characters that may sit inside a name: `J'zargo`, `Jerred Lund`, `M7-97`. */
const NAME_BOUNDARY = /[\p{L}\p{N}]/u;

/**
 * A pronoun counts when it sits in the same sentence as the name, or in the
 * one right after it — "Jake arrived. He looked tired." A wider window starts
 * picking up pronouns about whoever else is in the paragraph.
 */
const SENTENCE_END = /[.!?\n]/;
const SENTENCES_AFTER = 1;

const MALE_PRONOUNS = /\b(?:he|him|his|himself)\b/gi;
const FEMALE_PRONOUNS = /\b(?:she|her|hers|herself)\b/gi;

/**
 * Minimum gendered mentions before the count is worth believing.
 *
 * Six, not three, because of what a personified abstraction does to a lower
 * bar: Disco Elysium names a speaker `Conceptualization` and another `Drama`,
 * and three stray "he"s in sentences that merely contain the word were enough
 * to call both male — where the Ukrainian nouns are feminine. Both fall back to
 * `unknown` at six, and no speaker resolved in the Sim Settlements 2 corpus
 * this was tuned on is lost (17 of 25 either way).
 */
const MIN_EVIDENCE = 6;

/** Share the winning gender must hold to decide. */
const MIN_MAJORITY = 0.7;

export type PronounEvidence = {
  male: number;
  female: number;
  gender: SpeakerGender;
};

const isNameChar = (ch: string | undefined): boolean => ch != null && NAME_BOUNDARY.test(ch);

/** Offsets where `name` appears as a whole word, case-insensitively. */
const findNameOccurrences = (text: string, lowerName: string): number[] => {
  const haystack = text.toLowerCase();
  const found: number[] = [];

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(lowerName, from);
    if (at < 0) break;
    const before = haystack[at - 1];
    const after = haystack[at + lowerName.length];
    if (!isNameChar(before) && !isNameChar(after)) found.push(at);
    from = at + lowerName.length;
  }
  return found;
};

/** Start of the sentence the mention sits in. */
const sentenceStart = (text: string, at: number): number => {
  for (let i = at - 1; i >= 0; i--) {
    if (SENTENCE_END.test(text[i]!)) return i + 1;
  }
  return 0;
};

/**
 * End of the sentence the mention sits in, plus {@link SENTENCES_AFTER} more.
 *
 * A run of terminators ends one sentence, not several: `...`, `?!` and `.\n`
 * are each a single break.
 */
const sentenceEnd = (text: string, from: number): number => {
  let remaining = SENTENCES_AFTER + 1;
  let inBreak = false;
  for (let i = from; i < text.length; i++) {
    if (!SENTENCE_END.test(text[i]!)) {
      inBreak = false;
      continue;
    }
    if (inBreak) continue;
    inBreak = true;
    remaining--;
    if (remaining === 0) return i + 1;
  }
  return text.length;
};

/** The stretch of text a pronoun has to be in to count as being about the name. */
const mentionWindow = (text: string, at: number, nameLength: number): string =>
  text.slice(sentenceStart(text, at), sentenceEnd(text, at + nameLength));

const countMatches = (text: string, pattern: RegExp): number => {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text) != null) count++;
  return count;
};

/**
 * Tally gendered pronouns near every mention of `name` across `texts`.
 *
 * @param name - Display name of the speaker, as the mod writes it.
 * @param texts - Source-language strings of the mod. Lines the speaker says
 * themselves are as useful as any other: characters talk about each other.
 */
export const collectPronounEvidence = (name: string, texts: Iterable<string>): PronounEvidence => {
  const lowerName = name.trim().toLowerCase();
  // A one- or two-letter "name" matches half the corpus and proves nothing.
  if (lowerName.length < 3) return { male: 0, female: 0, gender: 'unknown' };

  let male = 0;
  let female = 0;

  for (const text of texts) {
    for (const at of findNameOccurrences(text, lowerName)) {
      const window = mentionWindow(text, at, lowerName.length);
      male += countMatches(window, MALE_PRONOUNS);
      female += countMatches(window, FEMALE_PRONOUNS);
    }
  }

  return { male, female, gender: decideGender(male, female) };
};

/** Majority verdict, or `unknown` when the evidence is thin or split. */
export const decideGender = (male: number, female: number): SpeakerGender => {
  const total = male + female;
  if (total < MIN_EVIDENCE) return 'unknown';
  if (male / total >= MIN_MAJORITY) return 'male';
  if (female / total >= MIN_MAJORITY) return 'female';
  return 'unknown';
};
