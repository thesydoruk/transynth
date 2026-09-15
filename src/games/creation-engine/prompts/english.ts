import type { EnglishPromptSections } from '../../contract';
import { buildEnglishPromptExamples } from '../../../llm/prompts/examples';

/**
 * The Creation Engine half of the shared English prompt.
 *
 * Every Bethesda title audits the same way — record types, item rarity tiers,
 * gear name templates — so the eight titles share one set of sections and only
 * substitute their own name.
 */
export const creationEngineEnglishSections = (title: string): EnglishPromptSections => ({
  translateRole: (targetLang) =>
    `You are a lead AI localizer for ${title} worlds into ${targetLang}, with deep knowledge of lore, Creation Kit (ESP/ESM) specifics, and community standards.`,
  verifyRole: (targetLang) =>
    `You are a strict but fair expert editor and LQA engineer (Language Quality Assurance) for ${title} localization into ${targetLang}.`,
  examples: (targetLang) => buildEnglishPromptExamples(targetLang),
  useCommonRules: true,
  pairingMismatchNotes: [
    '- Mismatch signals (one strong signal is enough):',
    '  • source is ONLY "Epic"/"Legendary"/"Rare"/etc. but translation is a long item name (armor, faction, slot) built from edid or batch — mismatch; "incorrect";',
    '  • source is an item name / UI line / dialogue but translation is only a rarity word with none of the key words from source;',
    '  • translation describes a different entity than source: different faction, item, or slot (e.g. source "Operators Light Arm Armor", translation names Disciples gear);',
    '  • source is short and translation is much longer with tokens or topics absent from source — or the reverse: detailed source but translation collapsed to a single UI word;',
    '  • key source words (faction, Arm/Leg/Helmet/Torso, Light/Heavy, set name) are missing from translation or replaced without support in source;',
    '  • edid and source agree (e.g. Operators/Pack/Disciples) but translation names a different faction or item.',
    '- Robot mod names (miscmod, edid with Bot/Sentry/Assaultron): do not add words absent from source; do not flip between transliterated model tokens and expanded creature names.',
  ],
  auditNotes: [
    '- Template mismatch within a numbered series — only when translation already matches the same source skeleton but uses different key words → "suspicious"; suggestion must be a full line derived from translating source, aligned with batch siblings or reference_examples of the same template.',
    '- TERM/BTXT, GMST/DATA, MESG, ARMO/FULL: translation on a different topic, faction, or row type — "incorrect" (TM/EDID failure), even if the translation is grammatically fine. Suggestion: null.',
    '- Bethesda specifics (grup/field/edid): record type must be respected; an item name (ARMO/FULL) should not read like a verb, rarity label, or casual dialogue line.',
  ],
});
