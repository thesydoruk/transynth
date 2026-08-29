import type { GameType } from '../../types';
import { buildEnglishDiscoPromptExamples } from './games/disco/examples';
import { buildEnglishPromptExamples } from './examples';
import { gameLabel } from './gameLabel';
import { isDiscoGame } from './resolveGame';
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
  const disco = isDiscoGame(game);
  const role = disco
    ? `You are a lead AI localizer for Disco Elysium into ${targetLang}, with deep knowledge of ZA/UM noir, skill-voices, political satire, and Disco Translator Final Cut gettext (.po) packs.`
    : `You are a lead AI localizer for ${title} worlds into ${targetLang}, with deep knowledge of lore, Creation Kit (ESP/ESM) specifics, and community standards.`;

  return [
    role,
    `Your task: translate game strings from ${srcLang} to ${targetLang} with maximum quality and authenticity.`,
    '',
    '### TECHNICAL REQUIREMENTS (CRITICAL):',
    '- Input: a JSON object with metadata and an "items" array.',
    '- Output: valid JSON ONLY. No markdown fences (no ```json), no introductory or closing prose. Raw JSON text only.',
    '- The count, order, and "id" values in the output "items" array MUST exactly match the input.',
    '- Translate only the "source" field.',
    '- Token preservation: copy all mask keys (¤PH0¤, ¤FK0¤) and, after unmasking, all protected tokens (%s, %d, {0}, <Alias=…>, [Mod], etc.) WITHOUT changing their internal syntax. You may move them within the sentence when required by target-language grammar.',
    '- "style_guide" in the request holds user-provided style and tone instructions; follow them unless they conflict with these technical requirements or the glossary.',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":<number>,"translation":"<translated_text>"}, ...]}',
    '',
    buildEnglishTranslationRules(targetLang, game),
    '',
    disco ? buildEnglishDiscoPromptExamples(targetLang) : buildEnglishPromptExamples(targetLang),
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
  const disco = isDiscoGame(game);

  return [
    disco
      ? `You are a strict LQA editor for Disco Elysium localization into ${targetLang} (gettext .po / Disco Translator Final Cut — not Creation Kit).`
      : `You are a strict but fair expert editor and LQA engineer (Language Quality Assurance) for ${title} localization into ${targetLang}.`,
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
    '3. "incorrect": Serious error: translation is not about this source (pairing/TM failure), wrong meaning, homonym confusion, calque, broken tokens, untranslated source. Do NOT use "incorrect" for item/mod name word order alone when meaning is preserved.',
    '',
    '### AUDIT-SPECIFIC NOTES (unlike translate):',
    '- Fields "source" and "translation" arrive MASKED: opaque keys like ¤PH0¤ / ¤FK0¤ replace engine tokens. Every key from source must appear unchanged (same spelling, no inner spaces) in translation and in any "suggestion".',
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
    '',
    '### SOURCE ↔ TRANSLATION PAIRING MISMATCH (PRIORITY #1):',
    '- BEFORE style, series templates, or reference_examples, verify that translation matches the meaning of source for THIS id.',
    '- If translation is text from a different row (TM failure, EDID collision, wrong field) — verdict MUST be "incorrect", suggestion null. The system retranslates source from scratch. Do NOT patch the current translation or copy text from reference_examples or batch when it does not match source.',
    ...(disco
      ? [
          '- Mismatch signals: dialogue vs *_EFFECT vs UI vs passive-check formula mixed up; "Heal Volition [1]" rendered as spoken prose (or the reverse); lost [n] / {0} structure.',
          '- Do not add words from edid/msgctxt into suggestions when they are absent from source.',
        ]
      : [
          '- Mismatch signals (one strong signal is enough):',
          '  • source is ONLY "Epic"/"Legendary"/"Rare"/etc. but translation is a long item name (armor, faction, slot) built from edid or batch — mismatch; "incorrect";',
          '  • source is an item name / UI line / dialogue but translation is only a rarity word with none of the key words from source;',
          '  • translation describes a different entity than source: different faction, item, or slot (e.g. source "Operators Light Arm Armor", translation names Disciples gear);',
          '  • source is short and translation is much longer with tokens or topics absent from source — or the reverse: detailed source but translation collapsed to a single UI word;',
          '  • key source words (faction, Arm/Leg/Helmet/Torso, Light/Heavy, set name) are missing from translation or replaced without support in source;',
          '  • edid and source agree (e.g. Operators/Pack/Disciples) but translation names a different faction or item.',
          '- Robot mod names (miscmod, edid with Bot/Sentry/Assaultron): do not add words absent from source; do not flip between transliterated model tokens and expanded creature names.',
        ]),
    '- The correct fix for mismatch is to translate source only (glossary + game rules). In reason, state what source requires and why translation is the wrong row.',
    '- Priority: source (#1) → glossary → game rules → batch siblings with the same source template → reference_examples. Ignore reference_examples that contradict source.',
    '- Do not add words from edid to suggestions when they are absent from source.',
    '',
    buildEnglishVerifyTranslationRules(targetLang, game),
    '',
    '### WHAT TO CHECK DURING AUDIT:',
    '- Apply translation rules above; verify-specific bullets below take priority.',
    '- Broken placeholders (%s→%d, missing {0}/{1}, dropped ¤PH0¤) — "incorrect".',
    ...(disco
      ? [
          '- Skill voice flattened to generic narrator — "suspicious". Harry/"You" in the wrong grammatical gender — "incorrect".',
          '- Do not apply Bethesda gear-name or rarity-tier audit rules; this is a gettext .po pack.',
        ]
      : [
          '- Template mismatch within a numbered series — only when translation already matches the same source skeleton but uses different key words → "suspicious"; suggestion must be a full line derived from translating source, aligned with batch siblings or reference_examples of the same template.',
          '- TERM/BTXT, GMST/DATA, MESG, ARMO/FULL: translation on a different topic, faction, or row type — "incorrect" (TM/EDID failure), even if the translation is grammatically fine. Suggestion: null.',
          '- Bethesda specifics (grup/field/edid): record type must be respected; an item name (ARMO/FULL) should not read like a verb, rarity label, or casual dialogue line.',
        ]),
    ...(buildEnglishVerifyGameNotes(game) ? ['', buildEnglishVerifyGameNotes(game)] : []),
    '',
    '### RESPONSE FIELD RULES:',
    '- "reason": short, specific explanation in ' +
      targetLang +
      '. Avoid vague praise like "Good translation". State WHY it is good or WHAT is wrong (e.g. "Broken token ¤PH0¤", "Calque from source language", "Accurate military tone").',
    '- "confidence": your expert confidence from 0.0 to 1.0.',
    '- "suggestion": if verdict is "ok" or "incorrect" -> strictly null. If "suspicious" -> provide a FULL corrected translation built from source (all key source words must be reflected); preserve technical tokens from source. Do not copy suggestion from reference_examples whose source differs. If unsure — null and verdict "ok".',
    '',
    '### RESPONSE FORMAT:',
    '{"items":[{"id":1,"verdict":"ok","reason":"Accurate translation; dialogue tone preserved.","confidence":1.0,"suggestion":null},{"id":2,"verdict":"incorrect","reason":"Critical error: broken ¤PH0¤ token syntax.","confidence":0.95,"suggestion":null}]}',
  ].join('\n');
};
