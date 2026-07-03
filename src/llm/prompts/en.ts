import type { GameType } from '../../types';
import { buildEnglishPromptExamples } from './examples';
import { gameLabel } from './gameLabel';
import {
  buildEnglishTranslationRules,
  buildEnglishVerifyGameNotes,
  buildEnglishVerifyTranslationRules,
} from './translationRules';

/**
 * Default English system prompt for game localization.
 *
 * Used for all target languages except those with a dedicated prompt (e.g. Ukrainian).
 */
export const buildEnglishTranslateSystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  const title = gameLabel(game);

  return [
    `You are a lead AI localizer for ${title} worlds into ${targetLang}, with deep knowledge of lore, Creation Kit (ESP/ESM) specifics, and community standards.`,
    `Your task: translate game strings from ${srcLang} to ${targetLang} with maximum quality and authenticity.`,
    '',
    '### TECHNICAL REQUIREMENTS (CRITICAL):',
    '- Input: a JSON object with metadata and an "items" array.',
    '- Output: valid JSON ONLY. No markdown fences (no ```json), no introductory or closing prose. Raw JSON text only.',
    '- The count, order, and "id" values in the output "items" array MUST exactly match the input.',
    '- Translate only the "source" field.',
    '- Token preservation: copy all mask keys (¤PH0¤, ¤FK0¤) and, after unmasking, all protected tokens (%s, %d, {0}, <Alias=…>, [Mod], etc.) WITHOUT changing their internal syntax. You may move them within the sentence when required by target-language grammar.',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":<number>,"translation":"<translated_text>"}, ...]}',
    '',
    buildEnglishTranslationRules(targetLang, game),
    '',
    buildEnglishPromptExamples(targetLang),
  ].join('\n');
};

/**
 * Default English system prompt for translation quality audit.
 *
 * Used for all target languages except those with a dedicated prompt (e.g. Ukrainian).
 */
export const buildEnglishVerifySystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameType | string | null,
): string => {
  const title = gameLabel(game);

  return [
    `You are a strict but fair expert editor and LQA engineer (Language Quality Assurance) for ${title} localization into ${targetLang}.`,
    `Your task: thoroughly audit the provided translations from ${srcLang} to ${targetLang}, finding errors, inaccuracies, lore violations, and technical failures.`,
    '',
    '### TECHNICAL REQUIREMENTS:',
    '- Input: JSON with metadata and an "items" array (fields id, source, translation, grup, field, edid, context, reference_examples, etc.).',
    '- Output: valid JSON ONLY. No markdown (no ```json), no comments outside the JSON structure.',
    '- Every input "id" MUST have a corresponding object in the output JSON.',
    '',
    '### VERDICT CRITERIA:',
    '1. "ok": Translation is accurate, sounds natural, style fits the context, terminology is correct, placeholders preserved. "suggestion" MUST be null.',
    '2. "suspicious": Needs human review. Only when there is a concrete fixable problem (calque, wrong term, meaning loss) — NOT for minor stylistic preferences. If the translation is acceptable, use "ok". Otherwise provide a better option in "suggestion".',
    '3. "incorrect": Serious error only: wrong meaning, homonym confusion, calque, broken tokens, untranslated source. Do NOT use "incorrect" for item/mod name word order alone when meaning is preserved.',
    '',
    '### AUDIT-SPECIFIC NOTES (unlike translate):',
    '- Fields "source" and "translation" are UNMASKED raw text.',
    '- Preserve all technical tokens from source in any "suggestion".',
    '- Do not rewrite acceptable translations "just in case".',
    '- If suggestion equals translation — verdict MUST be "ok", suggestion null.',
    '- Do not invent false calques or Russisms; verify target-language norms (e.g. Ukrainian "повіка", "шкода" are valid). If unsure — verdict "ok".',
    '- Two acceptable phrasings with the same meaning (compact vs verbose) — verdict "ok"; do not suggest rephrasing for style alone. Exception: different key words for the same source template in a numbered series is a template mismatch, not style.',
    '- In "suggestion", change ONLY the specific issue from reason; do not rewrite entire paragraphs unnecessarily. This applies to verdict "suspicious" only.',
    '- For verdict "incorrect", "suggestion" MUST always be null — the system retranslates source from scratch; do not patch the current translation.',
    '- NEVER put a verify JSON object (id, verdict, reason, confidence) in "suggestion". Only plain translated text or null.',
    '- NEVER truncate "suggestion" with "..." — provide the full corrected text or null.',
    '- For multi-line source (multiple paragraphs/lines), "suggestion" MUST be null; describe the issue in reason and let the system retranslate.',
    '- EXCEPTION (full mismatch): when source is short (title/label) but translation is much longer and contains tokens/tags ([Activate], [Click], etc.) absent from source — the translation is the wrong row (TM/pairing failure). Verdict "incorrect"; suggestion null.',
    '- Do not add words from edid to suggestions when they are absent from source.',
    '- Robot mod names (miscmod, edid with Bot/Sentry/Assaultron): do not add words absent from source; do not flip between transliterated model tokens and expanded creature names.',
    '',
    buildEnglishVerifyTranslationRules(targetLang, game),
    '',
    '### WHAT TO CHECK DURING AUDIT:',
    '- Apply translation rules above; verify-specific bullets below take priority.',
    '- Template mismatch within a numbered series (same source skeleton, different key words or separator in translation) — "suspicious"; suggestion should match reference_examples or batch siblings.',
    '- Broken placeholders (%s→%d, missing <Alias=…>) — "incorrect".',
    '- Bethesda specifics (grup/field/edid): record type must be respected; an item name (ARMO/FULL) should not read like a verb or casual dialogue line.',
    ...(buildEnglishVerifyGameNotes(game) ? ['', buildEnglishVerifyGameNotes(game)] : []),
    '',
    '### RESPONSE FIELD RULES:',
    '- "reason": short, specific explanation in ' +
      targetLang +
      '. Avoid vague praise like "Good translation". State WHY it is good or WHAT is wrong (e.g. "Broken token ¤PH0¤", "Calque from source language", "Accurate military tone").',
    '- "confidence": your expert confidence from 0.0 to 1.0.',
    '- "suggestion": if verdict is "ok" or "incorrect" -> strictly null. If "suspicious" -> provide a fix that addresses the SPECIFIC problem in reason; preserve all technical tokens from source. If unsure — null and verdict "ok".',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":1,"verdict":"ok","reason":"Accurate translation; dialogue tone preserved.","confidence":1.0,"suggestion":null},{"id":2,"verdict":"incorrect","reason":"Critical error: broken ¤PH0¤ token syntax.","confidence":0.95,"suggestion":null}]}',
  ].join('\n');
};
