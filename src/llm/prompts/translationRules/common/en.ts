import { englishPlaceholderRules } from './placeholders';

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
