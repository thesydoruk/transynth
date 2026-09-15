/**
 * The Elder Scrolls titles.
 *
 * Skyrim SE writes BSA v105 (LZ4); Skyrim LE, Oblivion and Morrowind write
 * v104 (zlib). Skyrim LE ships the same text as SE, so it reuses SE's prompts
 * and glossary rather than duplicating them.
 */
import type { CreationEngineTitle } from '../title';
import { compileSubrecordConfig, type GameSubrecordsConfig } from '../../../formats/subrecords';
import { compileRecorddefs, type RecorddefsJson } from '../../../formats/strings';
import { creationEngineEnglishSections } from '../prompts/english';

import sseSubrecords from '../data/subrecords/sse.json' with { type: 'json' };
import sleSubrecords from '../data/subrecords/sle.json' with { type: 'json' };
import obSubrecords from '../data/subrecords/ob.json' with { type: 'json' };
import mwSubrecords from '../data/subrecords/mw.json' with { type: 'json' };
import sseRecorddefs from '../data/recorddefs/sse.json' with { type: 'json' };
import fnvRecorddefs from '../data/recorddefs/fnv.json' with { type: 'json' };

import {
  FO3_FUNCTION_KEYWORDS,
  SLE_FUNCTION_KEYWORDS,
  SSE_FUNCTION_KEYWORDS,
} from '../data/functionKeywords';
import {
  noNpcReference,
  oblivionNpcReference,
  skyrimNpcReference,
  sseNpcReference,
} from '../data/npcReference';
import { SSE_UK_GLOSSARY } from '../data/glossary/sse-uk';
import { OB_UK_GLOSSARY } from '../data/glossary/ob-uk';
import { MW_UK_GLOSSARY } from '../data/glossary/mw-uk';

import { SSE_UK_TRANSLATE_PROMPT } from '../prompts/sse/translate';
import { SSE_UK_VERIFY_PROMPT } from '../prompts/sse/verify';
import { OB_UK_TRANSLATE_PROMPT } from '../prompts/ob/translate';
import { OB_UK_VERIFY_PROMPT } from '../prompts/ob/verify';
import { MW_UK_TRANSLATE_PROMPT } from '../prompts/mw/translate';
import { MW_UK_VERIFY_PROMPT } from '../prompts/mw/verify';
import { sseRules } from '../prompts/rules/sse';
import { obRules } from '../prompts/rules/ob';
import { mwRules } from '../prompts/rules/mw';

/** Both Skyrim editions ship the same base-game and DLC plugins. */
const SKYRIM_MASTERS = [
  'Skyrim.esm',
  'Update.esm',
  'Dawnguard.esm',
  'HearthFires.esm',
  'Dragonborn.esm',
];

export const skyrimSpecialEdition: CreationEngineTitle = {
  id: 'sse',
  catalogue: {
    id: 'sse',
    name: 'Skyrim Special Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2016,
    engine: 'Creation Engine',
    localized: true,
    nexus: { id: 1704, domain: 'skyrimspecialedition' },
  },
  subrecords: compileSubrecordConfig(sseSubrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([sseRecorddefs as RecorddefsJson]),
  npcReference: sseNpcReference,
  functionKeywords: SSE_FUNCTION_KEYWORDS,
  archive: { kind: 'bsa', bsaVersion: 105 },
  strings: { lookupOrder: ['bsa', 'loose'], officialLocales: null },
  voice: { faceFxTitle: 'Skyrim', packLangpackVoiceIntoBa2: false },
  deployment: {
    officialMasters: SKYRIM_MASTERS,
    localAppFolder: 'Skyrim Special Edition',
    vortexId: 'skyrimse',
    exeName: 'SkyrimSE.exe',
  },
  prompts: {
    label: 'Skyrim Special Edition',
    translateUk: () => SSE_UK_TRANSLATE_PROMPT,
    verifyUk: () => SSE_UK_VERIFY_PROMPT,
    rules: sseRules,
    glossary: SSE_UK_GLOSSARY,
    english: creationEngineEnglishSections('Skyrim Special Edition'),
  },
};

export const skyrimLegendaryEdition: CreationEngineTitle = {
  id: 'sle',
  catalogue: {
    id: 'sle',
    name: 'Skyrim Legendary Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2013,
    engine: 'Gamebryo/Creation Engine',
    localized: true,
    nexus: { id: 110, domain: 'skyrim' },
  },
  subrecords: compileSubrecordConfig(sleSubrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([sseRecorddefs as RecorddefsJson]),
  npcReference: skyrimNpcReference,
  functionKeywords: SLE_FUNCTION_KEYWORDS,
  archive: { kind: 'bsa', bsaVersion: 104 },
  strings: { lookupOrder: ['bsa', 'loose'], officialLocales: null },
  voice: { faceFxTitle: 'Skyrim', packLangpackVoiceIntoBa2: false },
  deployment: {
    officialMasters: SKYRIM_MASTERS,
    localAppFolder: 'Skyrim',
    vortexId: 'skyrim',
    exeName: 'SkyrimSE.exe',
  },
  // Same text as Skyrim SE — one term list, one QA rule set for both editions.
  storageKeys: { glossary: 'sse', qaRules: 'sse' },
  prompts: {
    label: 'Skyrim Legendary Edition',
    translateUk: () => SSE_UK_TRANSLATE_PROMPT,
    verifyUk: () => SSE_UK_VERIFY_PROMPT,
    rules: sseRules,
    glossary: SSE_UK_GLOSSARY,
    english: creationEngineEnglishSections('Skyrim Legendary Edition'),
  },
};

export const oblivion: CreationEngineTitle = {
  id: 'ob',
  catalogue: {
    id: 'ob',
    name: 'The Elder Scrolls IV: Oblivion',
    developer: 'Bethesda Game Studios',
    releaseYear: 2006,
    engine: 'Gamebryo',
    localized: false,
    nexus: { id: 101, domain: 'oblivion' },
  },
  subrecords: compileSubrecordConfig(obSubrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([fnvRecorddefs as RecorddefsJson]),
  npcReference: oblivionNpcReference,
  functionKeywords: FO3_FUNCTION_KEYWORDS,
  archive: { kind: 'bsa', bsaVersion: 104 },
  strings: { lookupOrder: ['loose'], officialLocales: null },
  voice: { faceFxTitle: 'Skyrim', packLangpackVoiceIntoBa2: false },
  deployment: {
    // Oblivion mods are loaded by name order, not against a master list.
    officialMasters: [],
    localAppFolder: 'Oblivion',
    vortexId: 'oblivion',
    exeName: 'Oblivion.exe',
  },
  prompts: {
    label: 'The Elder Scrolls IV: Oblivion',
    translateUk: () => OB_UK_TRANSLATE_PROMPT,
    verifyUk: () => OB_UK_VERIFY_PROMPT,
    rules: obRules,
    glossary: OB_UK_GLOSSARY,
    english: creationEngineEnglishSections('The Elder Scrolls IV: Oblivion'),
  },
};

export const morrowind: CreationEngineTitle = {
  id: 'mw',
  catalogue: {
    id: 'mw',
    name: 'The Elder Scrolls III: Morrowind',
    developer: 'Bethesda Game Studios',
    releaseYear: 2002,
    engine: 'Gamebryo',
    localized: false,
    nexus: { id: 100, domain: 'morrowind' },
  },
  subrecords: compileSubrecordConfig(mwSubrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([fnvRecorddefs as RecorddefsJson]),
  npcReference: noNpcReference,
  functionKeywords: FO3_FUNCTION_KEYWORDS,
  archive: { kind: 'bsa', bsaVersion: 104 },
  strings: { lookupOrder: ['loose'], officialLocales: null },
  voice: { faceFxTitle: 'Skyrim', packLangpackVoiceIntoBa2: false },
  deployment: {
    officialMasters: [],
    localAppFolder: 'Morrowind',
    vortexId: 'morrowind',
    exeName: 'Morrowind.exe',
  },
  prompts: {
    label: 'The Elder Scrolls III: Morrowind',
    translateUk: () => MW_UK_TRANSLATE_PROMPT,
    verifyUk: () => MW_UK_VERIFY_PROMPT,
    rules: mwRules,
    glossary: MW_UK_GLOSSARY,
    english: creationEngineEnglishSections('The Elder Scrolls III: Morrowind'),
  },
};
