import type { NarratorGender } from './narratorGender';

const FEMALE_PRONOUN_RE = /\b(she|her|hers|herself)\b/i;
const MALE_PRONOUN_RE = /\b(he|him|his|himself)\b/i;

const FEMALE_BODY_RE =
  /\b(my breasts?|my vagina|my pussy|i was pregnant|my womb|my clit(?:oris)?|my nipples?)\b/i;
const MALE_BODY_RE = /\b(my penis|my cock|my balls|my testicles|my dick)\b/i;

const FIRST_PERSON_RE = /\b(I|I'm|I've|I'd|I'll|my|me)\b/;

type HeuristicHit = { gender: NarratorGender; confidence: number; reason: string };

const scorePronouns = (text: string): HeuristicHit | null => {
  const female = (text.match(FEMALE_PRONOUN_RE) ?? []).length;
  const male = (text.match(MALE_PRONOUN_RE) ?? []).length;
  if (female >= 2 && female > male * 2) {
    return { gender: 'female', confidence: 0.85, reason: 'female pronouns in source' };
  }
  if (male >= 2 && male > female * 2) {
    return { gender: 'male', confidence: 0.85, reason: 'male pronouns in source' };
  }
  return null;
};

const scoreBody = (text: string): HeuristicHit | null => {
  if (FEMALE_BODY_RE.test(text)) {
    return { gender: 'female', confidence: 0.9, reason: 'female body references in source' };
  }
  if (MALE_BODY_RE.test(text)) {
    return { gender: 'male', confidence: 0.9, reason: 'male body references in source' };
  }
  return null;
};

/** Fast gender guess from source excerpt; null when LLM should decide. */
export const inferNarratorGenderHeuristic = (opts: {
  source: string;
  edid?: string | null;
  signature?: string | null;
}): HeuristicHit | null => {
  const excerpt = opts.source.slice(0, 4000);
  const body = scoreBody(excerpt);
  if (body) return body;

  const pronouns = scorePronouns(excerpt);
  if (pronouns) return pronouns;

  // Lore terminals without a diary voice — safe to skip LLM.
  if (opts.signature === 'TERM' && !FIRST_PERSON_RE.test(excerpt)) {
    return { gender: 'neutral', confidence: 0.75, reason: 'no first-person markers' };
  }

  return null;
};
