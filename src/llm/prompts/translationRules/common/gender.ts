/**
 * Participant gender rules for the composed English prompts.
 *
 * Mirrors the Ukrainian rules in `prompts/genderRules/uk.ts`, but stays generic
 * because these prompts serve every non-Ukrainian target language.
 */

/** Gender rules for translation. */
export const englishGenderRules = (): string[] => [
  '### SPEAKER AND ADDRESSEE GENDER (CRITICAL):',
  '- Dialog items may carry "speaker_gender" and "addressee_gender" with one of: "male", "female", "any", "unknown".',
  '- These fields are resolved from the plugin and outrank any guess made from the source text.',
  '- "male" / "female": use that grammatical gender for the participant wherever the target language marks it (past-tense verbs, predicative adjectives, participles).',
  '- "any": the player character, whose gender is chosen at runtime. The line must read correctly for either gender — rephrase impersonally or use a plural/neutral form. Never commit to one gender.',
  '- "unknown" or absent: do not guess. Use a neutral construction rather than defaulting to masculine.',
  '- "speaker" and "addressee" name the participants; use them for vocatives and register, never copy them into the translation.',
];

/** Gender rules for verification. */
export const englishVerifyGenderRules = (): string[] => [
  '### SPEAKER AND ADDRESSEE GENDER (VERIFY):',
  '- Check gendered wording in the translation against "speaker_gender" (first person) and "addressee_gender" (second person singular).',
  '- Wording that contradicts an explicit "male" or "female" → "incorrect".',
  '- Any gender-committed first- or second-person wording when the field is "any" → "suspicious": the player picks their gender, so the line must work for both.',
  '- "unknown" or absent: defaulting to masculine without a hint in source → "suspicious"; a correct neutral rephrasing → "ok".',
  '- A neutral, natural translation is "ok" even when the metadata gives a concrete gender — do not rewrite it just to add gender marking.',
];
