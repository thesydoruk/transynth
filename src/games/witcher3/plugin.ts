/**
 * The Witcher 3: Wild Hunt, through the Remastered edition (2026-09-29).
 *
 * REDengine 3 keeps all player-visible text in `.w3strings` tables, one per
 * language in every `content` folder of the game, its DLC and its mods. The
 * Remastered edition moved them to UTF-8 (format 164) and added an official
 * Ukrainian table, `ua.w3strings`; the codec reads both generations and the
 * export writes whichever the imported game uses.
 *
 * The tables hold nothing but ids, key hashes and text. Who says each line,
 * and to whom, is in the scene files inside the game's `.bundle` archives
 * (`scenes/`), which the import reads: spoken lines become `W3D` records with a
 * speaker and addressee of known gender, everything else `W3S`.
 *
 * Voice is the `<lang>pc.w3speech` containers: takes keyed by the string id of
 * their line, each with a mouth animation (see `voice/`).
 */
import type { GamePlugin } from '../contract';
import { WITCHER3_EDITOR } from './editor';
import { witcher3ExportAdapter } from './export';
import { witcher3ImportAdapter } from './import';
import { witcher3TextAdapter } from './text';
import { witcher3VoiceAdapter } from './voice';
import { witcher3DialogAdapter } from './dialog';
import { WITCHER3_UK_GLOSSARY } from './prompts/glossary';
import { buildEnglishWitcher3PromptExamples } from './prompts/examples';
import { witcher3Rules } from './prompts/rules';
import { WITCHER3_UK_TRANSLATE_PROMPT } from './prompts/translate';
import { WITCHER3_UK_VERIFY_PROMPT } from './prompts/verify';

export const witcher3Plugin: GamePlugin = {
  id: 'w3',

  catalogue: {
    id: 'w3',
    name: 'The Witcher 3: Wild Hunt',
    developer: 'CD PROJEKT RED',
    releaseYear: 2015,
    engine: 'REDengine 3',
    localized: true,
    nexus: { id: 952, domain: 'witcher3' },
  },

  storageKeys: { glossary: 'w3', qaRules: 'w3' },

  editor: WITCHER3_EDITOR,
  text: witcher3TextAdapter,
  import: witcher3ImportAdapter,
  export: witcher3ExportAdapter,
  voice: witcher3VoiceAdapter,
  dialog: witcher3DialogAdapter,
  // No deployment adapter: Witcher 3 mods are folders under `mods/`, with no
  // load order for Transynth to write.

  prompts: {
    label: 'The Witcher 3',
    translateUk: () => WITCHER3_UK_TRANSLATE_PROMPT,
    verifyUk: () => WITCHER3_UK_VERIFY_PROMPT,
    rules: witcher3Rules,
    glossary: WITCHER3_UK_GLOSSARY,
    english: {
      translateRole: (targetLang) =>
        `You are a lead AI localizer for The Witcher 3: Wild Hunt into ${targetLang}, with deep knowledge of Andrzej Sapkowski's saga, CD PROJEKT RED's writing, and REDengine .w3strings string tables.`,
      verifyRole: (targetLang) =>
        `You are a strict LQA editor for The Witcher 3 localization into ${targetLang} (.w3strings string tables — not Creation Kit).`,
      examples: (targetLang) => buildEnglishWitcher3PromptExamples(targetLang),
      // The shared bullets talk about records, item rarities and gear-name
      // templates; a string table has none of those.
      useCommonRules: false,
      pairingMismatchNotes: [
        '- Mismatch signals: a UI label paired with a dialogue line (or the reverse); a different character, monster or item named; lost <br>/<font>/{0} structure.',
        '- The edid, when present, is the string key (e.g. panel_…); never copy it into a suggestion.',
      ],
      auditNotes: [
        '- Geralt in feminine grammatical gender, or Ciri in masculine — "incorrect".',
        '- Do not apply Bethesda gear-name or rarity-tier audit rules; these are .w3strings tables.',
      ],
    },
  },
};
