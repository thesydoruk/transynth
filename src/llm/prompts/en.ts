import type { GameId } from '../../types';
import { gamePlugin } from '../../games/registry';
import {
  buildEnglishTranslationRules,
  buildEnglishVerifyGameNotes,
  buildEnglishVerifyTranslationRules,
} from './translationRules';

/**
 * Default English system prompt for game localization.
 *
 * Used for every target language without a dedicated prompt (Ukrainian has
 * one per game). The scaffolding below is shared; each game fills in its own
 * role line, worked examples, and audit bullets through its prompt adapter.
 */
export const buildEnglishTranslateSystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameId | string | null,
): string => {
  const { english } = gamePlugin(game).prompts;

  return [
    english.translateRole(targetLang),
    `Your task: translate game strings from ${srcLang} to ${targetLang} with maximum quality and authenticity.`,
    '',
    '### TECHNICAL REQUIREMENTS (CRITICAL):',
    '- Input: a JSON object with metadata and an "items" array.',
    '- Output: valid JSON ONLY. No markdown fences (no ```json), no introductory or closing prose. Raw JSON text only.',
    '- The count, order, and "id" values in the output "items" array MUST exactly match the input.',
    '- Translate only the string fragments in "parts". Integer elements are slots — copy each id as many times as it appears. You may reorder slot ids for target-language grammar.',
    '- Never write raw engine tokens (%s, %d, {0}, <Alias=…>, [Mod], ¤PH0¤) inside a string part. Optional "slots" lists kind only.',
    '- "style_guide" in the request holds user-provided style and tone instructions; follow them unless they conflict with these technical requirements or the glossary.',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":<number>,"parts":["text",0," more"]}, ...]}',
    '',
    buildEnglishTranslationRules(targetLang, game),
    '',
    english.examples(targetLang),
  ].join('\n');
};

/**
 * Default English system prompt for translation quality audit.
 *
 * Used for every target language without a dedicated prompt.
 */
export const buildEnglishVerifySystemPrompt = (
  srcLang: string,
  targetLang: string,
  game?: GameId | string | null,
): string => {
  const { english } = gamePlugin(game).prompts;
  const gameNotes = buildEnglishVerifyGameNotes(game);

  return [
    english.verifyRole(targetLang),
    `Your task: thoroughly audit the provided translations from ${srcLang} to ${targetLang}, finding errors, inaccuracies, lore violations, and technical failures.`,
    '',
    '### TECHNICAL REQUIREMENTS:',
    '- Input: JSON with metadata and an "items" array (fields id, parts, translation_parts, slots, grup, field, edid, context, reference_examples, etc.).',
    '- Output: valid JSON ONLY. No markdown (no ```json), no comments outside the JSON structure.',
    '- Every input "id" MUST have a corresponding object in the output JSON.',
    '',
    '### VERDICT CRITERIA:',
    '1. "ok": Translation is accurate, sounds natural, style fits the context, terminology is correct, placeholders preserved. "suggestion" MUST be null.',
    '2. "suspicious": Needs human review. Only when there is a concrete fixable problem (calque, wrong term, meaning loss) — NOT for minor stylistic preferences. If the translation is acceptable, use "ok". Otherwise provide a better option in "suggestion".',
    '3. "incorrect": Serious error: translation is not about this source (pairing/TM failure), wrong meaning, homonym confusion, calque, broken tokens, untranslated source. Do NOT use "incorrect" for item/mod name word order alone when meaning is preserved.',
    '',
    '### AUDIT-SPECIFIC NOTES (unlike translate):',
    '- Items arrive as "parts" / "translation_parts" plus optional "slots". Suggestion is a parts array (or null) with the same slot-id multiset. Do not write raw tokens inside a string.',
    '- Preserve all technical tokens from source in any "suggestion".',
    '- Do not rewrite acceptable translations "just in case".',
    '- If suggestion equals translation_parts — verdict MUST be "ok", suggestion null.',
    '- Do not invent false calques or Russisms; verify target-language norms (e.g. Ukrainian "повіка", "шкода" are valid). If unsure — verdict "ok".',
    '- Two acceptable phrasings with the same meaning (compact vs verbose) — verdict "ok"; do not suggest rephrasing for style alone. Exception: different key words for the same source template in a numbered series is a template mismatch, not style.',
    '- In "suggestion", change ONLY the specific issue from reason; do not rewrite entire paragraphs unnecessarily. This applies to verdict "suspicious" only.',
    '- For verdict "incorrect", "suggestion" MUST always be null — the system retranslates source from scratch; do not patch the current translation.',
    '- NEVER put a verify JSON object (id, verdict, reason, confidence) in "suggestion". Only a parts array or null.',
    '- NEVER truncate "suggestion" with "..." — provide the full corrected parts or null.',
    '- For multi-line source (multiple paragraphs/lines), "suggestion" MUST be null; describe the issue in reason and let the system retranslate.',
    '',
    '### SOURCE ↔ TRANSLATION PAIRING MISMATCH (PRIORITY #1):',
    '- BEFORE style, series templates, or reference_examples, verify that translation matches the meaning of source for THIS id.',
    '- If translation is text from a different row (TM failure, EDID collision, wrong field) — verdict MUST be "incorrect", suggestion null. The system retranslates source from scratch. Do NOT patch the current translation or copy text from reference_examples or batch when it does not match source.',
    ...english.pairingMismatchNotes,
    '- The correct fix for mismatch is to translate source only (glossary + game rules). In reason, state what source requires and why translation is the wrong row.',
    '- Priority: source (#1) → glossary → game rules → batch siblings with the same source template → reference_examples. Ignore reference_examples that contradict source.',
    '- Do not add words from edid to suggestions when they are absent from source.',
    '',
    buildEnglishVerifyTranslationRules(targetLang, game),
    '',
    '### WHAT TO CHECK DURING AUDIT:',
    '- Apply translation rules above; verify-specific bullets below take priority.',
    '- Broken slots (dropped/invented id, raw %s or <Alias=…> in a string, %s→%d) — "incorrect".',
    ...english.auditNotes,
    ...(gameNotes ? ['', gameNotes] : []),
    '',
    '### RESPONSE FIELD RULES:',
    '- "reason": short, specific explanation in ' +
      targetLang +
      '. Avoid vague praise like "Good translation". State WHY it is good or WHAT is wrong (e.g. "Dropped slot 0", "Calque from source language", "Accurate military tone").',
    '- "confidence": your expert confidence from 0.0 to 1.0.',
    '- "suggestion": if verdict is "ok" or "incorrect" -> strictly null. If "suspicious" -> provide FULL corrected parts built from source (same slot-id multiset; all key source words must be reflected). Do not copy suggestion from reference_examples whose source differs. If unsure — null and verdict "ok".',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":1,"verdict":"ok","reason":"Accurate translation; dialogue tone preserved.","confidence":1.0,"suggestion":null},{"id":2,"verdict":"incorrect","reason":"Critical error: dropped or invented slot id.","confidence":0.95,"suggestion":null}]}',
  ].join('\n');
};
