/**
 * The Fallout titles.
 *
 * Fallout 4 and 76 run Creation Engine and pack into BA2; Fallout 3 and New
 * Vegas are Gamebryo with BSA archives and plugins that keep their text inline
 * instead of in string tables.
 */
import type { CreationEngineTitle } from '../title';
import { compileSubrecordConfig, type GameSubrecordsConfig } from '../../../formats/subrecords';
import { compileRecorddefs, type RecorddefsJson } from '../../../formats/strings';
import { creationEngineEnglishSections } from '../prompts/english';

import fo4Subrecords from '../data/subrecords/fo4.json' with { type: 'json' };
import fo76Subrecords from '../data/subrecords/fo76.json' with { type: 'json' };
import fo3Subrecords from '../data/subrecords/fo3.json' with { type: 'json' };
import fnvSubrecords from '../data/subrecords/fnv.json' with { type: 'json' };
import fo4Recorddefs from '../data/recorddefs/fo4.json' with { type: 'json' };
import fo76Recorddefs from '../data/recorddefs/fo76.json' with { type: 'json' };
import fnvRecorddefs from '../data/recorddefs/fnv.json' with { type: 'json' };

import {
  FNV_FUNCTION_KEYWORDS,
  FO3_FUNCTION_KEYWORDS,
  FO4_FUNCTION_KEYWORDS,
} from '../data/functionKeywords';
import {
  fnvNpcReference,
  fo3NpcReference,
  fo4NpcReference,
  noNpcReference,
} from '../data/npcReference';
import { FO3_UK_GLOSSARY } from '../data/glossary/fo3-uk';
import { FO4_UK_GLOSSARY } from '../data/glossary/fo4-uk';
import { FO76_UK_GLOSSARY } from '../data/glossary/fo76-uk';
import { FNV_UK_GLOSSARY } from '../data/glossary/fnv-uk';

import { fo4UkTranslatePrompt, fo4UkVerifyPrompt } from '../prompts/fo4/families';
import { resolveFo4PromptFamily } from '../prompts/fo4/families/resolve';
import { FO4_UK_DIALOG_RECAST_PROMPT } from '../prompts/fo4/recast';
import { FO76_UK_TRANSLATE_PROMPT } from '../prompts/fo76/translate';
import { FO76_UK_VERIFY_PROMPT } from '../prompts/fo76/verify';
import { FO3_UK_TRANSLATE_PROMPT } from '../prompts/fo3/translate';
import { FO3_UK_VERIFY_PROMPT } from '../prompts/fo3/verify';
import { FNV_UK_TRANSLATE_PROMPT } from '../prompts/fnv/translate';
import { FNV_UK_VERIFY_PROMPT } from '../prompts/fnv/verify';
import { fo4Rules } from '../prompts/rules/fo4';
import { fo76Rules } from '../prompts/rules/fo76';
import { fo3Rules } from '../prompts/rules/fo3';
import { fnvRules } from '../prompts/rules/fnv';

/**
 * Locale suffixes Fallout 4 / 76 ship string tables and Interface files for.
 * A target outside this set is written into the `en` and `ru` slots instead.
 */
const FO4_OFFICIAL_LOCALES = new Set([
  'en',
  'ru',
  'de',
  'fr',
  'es',
  'esmx',
  'it',
  'pl',
  'ptbr',
  'ja',
  'cn',
]);

export const fallout4: CreationEngineTitle = {
  id: 'fo4',
  catalogue: {
    id: 'fo4',
    name: 'Fallout 4',
    developer: 'Bethesda Game Studios',
    releaseYear: 2015,
    engine: 'Creation Engine',
    localized: true,
    nexus: { id: 1151, domain: 'fallout4' },
  },
  subrecords: compileSubrecordConfig(fo4Subrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([fo4Recorddefs as RecorddefsJson]),
  npcReference: fo4NpcReference,
  functionKeywords: FO4_FUNCTION_KEYWORDS,
  archive: { kind: 'ba2', bsaVersion: 104 },
  strings: { lookupOrder: ['loose', 'ba2'], officialLocales: FO4_OFFICIAL_LOCALES },
  voice: { faceFxTitle: 'Fallout4', packLangpackVoiceIntoBa2: true },
  deployment: {
    officialMasters: [
      'Fallout4.esm',
      'DLCRobot.esm',
      'DLCworkshop01.esm',
      'DLCCoast.esm',
      'DLCworkshop02.esm',
      'DLCworkshop03.esm',
      'DLCNukaWorld.esm',
    ],
    localAppFolder: 'Fallout4',
    vortexId: 'fallout4',
    exeName: 'Fallout4.exe',
  },
  prompts: {
    label: 'Fallout 4',
    translateUk: (family) => fo4UkTranslatePrompt(family ?? 'item'),
    verifyUk: (family) => fo4UkVerifyPrompt(family ?? 'item'),
    rules: fo4Rules,
    glossary: FO4_UK_GLOSSARY,
    english: creationEngineEnglishSections('Fallout 4'),
    resolveFamily: resolveFo4PromptFamily,
    recast: {
      prompt: FO4_UK_DIALOG_RECAST_PROMPT,
      // The first pass juggles voice, glossary and adaptation at once and
      // routinely leaks player gender; only Ukrainian dialogue needs the fix.
      appliesTo: (targetLang, family) => targetLang === 'uk' && family === 'dialog',
    },
  },
};

export const fallout76: CreationEngineTitle = {
  id: 'fo76',
  catalogue: {
    id: 'fo76',
    name: 'Fallout 76',
    developer: 'Bethesda Game Studios',
    releaseYear: 2018,
    engine: 'Creation Engine 2',
    localized: true,
    nexus: { id: 2299, domain: 'fallout76' },
  },
  subrecords: compileSubrecordConfig(fo76Subrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([
    fo4Recorddefs as RecorddefsJson,
    fo76Recorddefs as RecorddefsJson,
  ]),
  npcReference: noNpcReference,
  functionKeywords: FO4_FUNCTION_KEYWORDS,
  archive: { kind: 'ba2', bsaVersion: 104 },
  strings: { lookupOrder: ['loose', 'ba2'], officialLocales: FO4_OFFICIAL_LOCALES },
  voice: { faceFxTitle: 'Fallout4', packLangpackVoiceIntoBa2: false },
  deployment: {
    officialMasters: ['SeventySix.esm'],
    localAppFolder: 'Fallout76',
    vortexId: 'fallout76',
    exeName: 'Fallout76.exe',
  },
  // Fallout 76 reuses Fallout 4's QA rule set: same engine, same string shapes.
  storageKeys: { qaRules: 'fo4' },
  prompts: {
    label: 'Fallout 76',
    translateUk: () => FO76_UK_TRANSLATE_PROMPT,
    verifyUk: () => FO76_UK_VERIFY_PROMPT,
    rules: fo76Rules,
    glossary: FO76_UK_GLOSSARY,
    english: creationEngineEnglishSections('Fallout 76'),
  },
};

export const fallout3: CreationEngineTitle = {
  id: 'fo3',
  catalogue: {
    id: 'fo3',
    name: 'Fallout 3',
    developer: 'Bethesda Game Studios',
    releaseYear: 2008,
    engine: 'Gamebryo',
    localized: false,
    nexus: { id: 120, domain: 'fallout3' },
  },
  subrecords: compileSubrecordConfig(fo3Subrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([fnvRecorddefs as RecorddefsJson]),
  npcReference: fo3NpcReference,
  functionKeywords: FO3_FUNCTION_KEYWORDS,
  archive: { kind: 'bsa', bsaVersion: 104 },
  strings: { lookupOrder: ['bsa', 'loose'], officialLocales: null },
  voice: { faceFxTitle: 'Fallout3', packLangpackVoiceIntoBa2: false },
  deployment: {
    officialMasters: [
      'Fallout3.esm',
      'Anchorage.esm',
      'ThePitt.esm',
      'BrokenSteel.esm',
      'PointLookout.esm',
      'Zeta.esm',
    ],
    localAppFolder: 'Fallout3',
    vortexId: 'fallout3',
    exeName: 'Fallout3.exe',
  },
  prompts: {
    label: 'Fallout 3',
    translateUk: () => FO3_UK_TRANSLATE_PROMPT,
    verifyUk: () => FO3_UK_VERIFY_PROMPT,
    rules: fo3Rules,
    glossary: FO3_UK_GLOSSARY,
    english: creationEngineEnglishSections('Fallout 3'),
  },
};

export const falloutNewVegas: CreationEngineTitle = {
  id: 'fnv',
  catalogue: {
    id: 'fnv',
    name: 'Fallout: New Vegas',
    developer: 'Obsidian Entertainment',
    releaseYear: 2010,
    engine: 'Gamebryo',
    localized: false,
    nexus: { id: 130, domain: 'newvegas' },
  },
  subrecords: compileSubrecordConfig(fnvSubrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([fnvRecorddefs as RecorddefsJson]),
  npcReference: fnvNpcReference,
  functionKeywords: FNV_FUNCTION_KEYWORDS,
  archive: { kind: 'bsa', bsaVersion: 104 },
  strings: { lookupOrder: ['bsa', 'loose'], officialLocales: null },
  voice: { faceFxTitle: 'FalloutNV', packLangpackVoiceIntoBa2: false },
  deployment: {
    officialMasters: [
      'FalloutNV.esm',
      'DeadMoney.esm',
      'HonestHearts.esm',
      'OldWorldBlues.esm',
      'LonesomeRoad.esm',
      'GunRunnersArsenal.esm',
    ],
    localAppFolder: 'FalloutNV',
    vortexId: 'falloutnv',
    exeName: 'FalloutNV.exe',
  },
  prompts: {
    label: 'Fallout: New Vegas',
    translateUk: () => FNV_UK_TRANSLATE_PROMPT,
    verifyUk: () => FNV_UK_VERIFY_PROMPT,
    rules: fnvRules,
    glossary: FNV_UK_GLOSSARY,
    english: creationEngineEnglishSections('Fallout: New Vegas'),
  },
};
