/**
 * Disco Elysium (Final Cut) — the app's non-Bethesda title.
 *
 * A Unity game with no plugin format, no archives, and no string tables: its
 * localization is a folder per language holding gettext `.po` catalogues and
 * loose `.wav` takes. It shares nothing with the Creation Engine pipeline
 * beyond the database and the LLM, which is exactly what the plugin contract
 * is meant to make possible.
 */
import type { GamePlugin } from '../contract';
import { DISCO_EDITOR } from './editor';
import { discoExportAdapter } from './export';
import { discoImportAdapter } from './import';
import { discoTextAdapter } from './text';
import { discoDialogAdapter } from './dialog';
import { discoVoiceAdapter } from './voice';
import { DISCO_UK_GLOSSARY } from './prompts/glossary';
import { buildEnglishDiscoPromptExamples } from './prompts/examples';
import { discoRules } from './prompts/rules';
import { DISCO_UK_TRANSLATE_PROMPT } from './prompts/translate';
import { DISCO_UK_VERIFY_PROMPT } from './prompts/verify';

export const discoElysiumPlugin: GamePlugin = {
  id: 'disco',

  catalogue: {
    id: 'disco',
    name: 'Disco Elysium',
    developer: 'ZA/UM',
    releaseYear: 2019,
    engine: 'Unity',
    localized: false,
    nexus: { id: 3027, domain: 'discoelysium' },
  },

  storageKeys: { glossary: 'disco', qaRules: 'disco' },

  editor: DISCO_EDITOR,
  text: discoTextAdapter,
  import: discoImportAdapter,
  export: discoExportAdapter,
  dialog: discoDialogAdapter,
  voice: discoVoiceAdapter,
  // Not a mod-manager-deployed title: no plugin load order to write.

  prompts: {
    label: 'Disco Elysium',
    translateUk: () => DISCO_UK_TRANSLATE_PROMPT,
    verifyUk: () => DISCO_UK_VERIFY_PROMPT,
    rules: discoRules,
    glossary: DISCO_UK_GLOSSARY,
    english: {
      translateRole: (targetLang) =>
        `You are a lead AI localizer for Disco Elysium into ${targetLang}, with deep knowledge of ZA/UM noir, skill-voices, political satire, and Disco Translator Final Cut gettext (.po) packs.`,
      verifyRole: (targetLang) =>
        `You are a strict LQA editor for Disco Elysium localization into ${targetLang} (gettext .po / Disco Translator Final Cut — not Creation Kit).`,
      examples: (targetLang) => buildEnglishDiscoPromptExamples(targetLang),
      // The shared bullets are written around records, item rarities and gear
      // name templates; none of that exists in a `.po` pack.
      useCommonRules: false,
      pairingMismatchNotes: [
        '- Mismatch signals: dialogue vs *_EFFECT vs UI vs passive-check formula mixed up; "Heal Volition [1]" rendered as spoken prose (or the reverse); lost [n] / {0} structure.',
        '- Do not add words from edid/msgctxt into suggestions when they are absent from source.',
      ],
      auditNotes: [
        '- Skill voice flattened to generic narrator — "suspicious". Harry/"You" in the wrong grammatical gender — "incorrect".',
        '- Do not apply Bethesda gear-name or rarity-tier audit rules; this is a gettext .po pack.',
      ],
    },
  },
};
