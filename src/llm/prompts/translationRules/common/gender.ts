/**
 * Participant gender rules for the composed English prompts.
 *
 * Mirrors the Ukrainian rules in `prompts/genderRules/uk.ts`, but stays generic
 * because these prompts serve every non-Ukrainian target language.
 */

/** Gender rules for translation. */
export const englishGenderRules = (): string[] => [
  '### SPEAKER AND ADDRESSEE (CRITICAL):',
  '- Dialog items may carry "speaker", "speaker_gender", "addressee", and "addressee_gender". Use every field that is present.',
  '- These fields are resolved from the plugin and outrank any guess made from the source text.',
  '- "speaker" / "addressee" name the participants; use them for vocatives and register, never copy them into the translation.',
  '- "male" / "female": use that grammatical gender for the participant wherever the target language marks it (past-tense verbs, predicative adjectives, participles).',
  '- "addressee_gender": "any" with addressee "Player" means the line is addressed TO the player: rephrase neutrally (impersonal or plural "you") — never commit to one gender in second-person singular.',
  '- "speaker_gender": "any" with speaker "Player" means a generic player line: keep first person neutral unless speaker_gender is explicitly "male" or "female".',
  '- Explicit "male" / "female" on speaker "Player" marks a gender-specific player variant (separate INFO for Nate/Nora): use that gender in first person.',
  '- "unknown" or absent: do not guess. Use a neutral construction rather than defaulting to masculine.',
];

/** Gender rules for verification. */
export const englishVerifyGenderRules = (): string[] => [
  '### SPEAKER AND ADDRESSEE (VERIFY):',
  '- Check gendered wording against all present fields: "speaker", "speaker_gender", "addressee", "addressee_gender".',
  '- Wording that contradicts an explicit "male" or "female" → "incorrect".',
  '- Lines addressed to the player (addressee "Player", addressee_gender "any"): gender-committed second-person singular → "suspicious"; neutral/plural rephrase → "ok".',
  '- Generic player lines (speaker "Player", speaker_gender "any"): gender-committed first person → "suspicious".',
  '- Gender-specific player variants (speaker "Player" with speaker_gender "male" or "female"): matching gender in first person → "ok".',
  '- "unknown" or absent: defaulting to masculine without a hint in source → "suspicious"; a correct neutral rephrasing → "ok".',
  '- A neutral, natural translation is "ok" even when the metadata gives a concrete gender — do not rewrite it just to add gender marking.',
];
