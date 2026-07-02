import { englishPlaceholderRules, englishVerifyPlaceholderRules } from './placeholders';

/** Rules shared across all Bethesda games (English prompt, any target language). */
export const englishCommonRules = (targetLang: string): string[] => [
  ...englishPlaceholderRules(),
  '',
  '### CAPITALIZATION:',
  '- Preserve the source capitalization pattern. Do not use ALL CAPS in the translation unless the entire source string is ALL CAPS.',
  '- Title case or sentence case in the source → natural capitalization in the target language, not all-caps styling.',
  '- Use ALL CAPS only when the source is entirely upper-case (e.g. short UI abbreviations).',
  '- Do not raise capitalization for emphasis on item names, materials, or UI labels.',
  '',
  '### REGISTER AND ADDRESS:',
  '- Match the in-game relationship and formality implied by context, speaker, and addressee.',
  "- Use informal vs formal address consistently with the target language's conventions and the string's role.",
  '',
  '### LINGUISTIC QUALITY:',
  '- Write fluent, idiomatic ' + targetLang + '.',
  '- Avoid calques, awkward literal translations, and source-language grammar transplanted into the target language.',
  '- Prefer precise, natural vocabulary and phrasing that fits the lore and setting.',
  '- Keep UI strings short; keep dialogue lines speakable.',
  '',
  '### TERMINOLOGY AND ESP/ESM CONTEXT:',
  '- Glossary: when "glossary" terms are provided, integrate them WITHOUT changing the base term (inflect/conjugate only as required by target-language grammar).',
  '- Reference examples: when "reference_examples" are provided, your translation MUST align with their terminology, style, and tone (especially when grup, field, and edid match).',
  '- Do not convert numeric values unless the source clearly expects localization.',
  '- Metadata (grup, field, edid, form_id, context): use these as the primary guide for WHO speaks, TO WHOM, and WHERE the text appears. Consider edid prefixes (e.g. MQ = main quest, Companion_ = companion line). Do not copy metadata into the translation.',
  '- Homonyms: the same English word may need different translations by grup/field (e.g. "Light" in ARMO/FULL vs WEAP/MOD).',
];

/** Shared verify/audit rules (raw text — no translate-time masking). */
export const englishVerifyCommonRules = (targetLang: string): string[] => [
  ...englishVerifyPlaceholderRules(),
  '',
  '### CAPITALIZATION:',
  '- Preserve the source capitalization pattern unless the source is ALL CAPS.',
  '',
  '### LINGUISTIC QUALITY:',
  '- Write fluent, idiomatic ' + targetLang + '.',
  '- Avoid calques and awkward literal translations.',
  '',
  '### TERMINOLOGY AND ESP/ESM CONTEXT (VERIFY):',
  '- Glossary: apply only when the term appears in source.',
  '- Glossary "Sentry Bot" is for creature/dialogue references; model token "Sentry" in item names/edid — transliterate, do not expand to a creature name in item labels.',
  '- reference_examples: use ONLY for terminology. Do NOT copy word order from a different item unless grup, field, and edid pattern match.',
  '- Metadata (grup, field, edid): context only; do not copy edid into the translation.',
];
