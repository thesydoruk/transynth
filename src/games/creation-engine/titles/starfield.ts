/**
 * Starfield.
 *
 * Creation Engine 2: the plugin container and the STRINGS tables are Fallout
 * 4's, but the record set is its own (terminals are `TMLM`), base-game tables
 * live in `<Plugin> - Localization.ba2` rather than `- Interface` / `- Main`,
 * and there is no Russian release — an unofficial target takes the `en` slot
 * alone. Official Creations are `sfbgs*` (Bethesda's own) and `sfta*` (the
 * Trackers Alliance series), not `cc*`.
 */
import type { CreationEngineTitle } from '../title';
import { compileSubrecordConfig, type GameSubrecordsConfig } from '../../../formats/subrecords';
import { compileRecorddefs, type RecorddefsJson } from '../../../formats/strings';
import { creationEngineEnglishSections } from '../prompts/english';

import sf1Subrecords from '../data/subrecords/sf1.json' with { type: 'json' };
import sf1Recorddefs from '../data/recorddefs/sf1.json' with { type: 'json' };

import { SF1_FUNCTION_KEYWORDS } from '../data/functionKeywords';
import { STARFIELD_RECORD_LAYOUT } from '../import/recordLayouts';
import { noNpcReference } from '../data/npcReference';
import { SF1_UK_GLOSSARY } from '../data/glossary/sf1-uk';
import { SF1_UK_TRANSLATE_PROMPT } from '../prompts/sf1/translate';
import { SF1_UK_VERIFY_PROMPT } from '../prompts/sf1/verify';
import { sf1Rules } from '../prompts/rules/sf1';

/** Text languages Starfield ships (Steam: nine, no Russian), as file suffixes. */
const SF1_OFFICIAL_LOCALES = new Set(['en', 'de', 'es', 'fr', 'it', 'ja', 'pl', 'ptbr', 'zhhans']);

export const starfield: CreationEngineTitle = {
  id: 'sf1',
  catalogue: {
    id: 'sf1',
    name: 'Starfield',
    developer: 'Bethesda Game Studios',
    releaseYear: 2023,
    engine: 'Creation Engine 2',
    localized: true,
    nexus: { id: 4187, domain: 'starfield' },
  },
  subrecords: compileSubrecordConfig(sf1Subrecords as GameSubrecordsConfig),
  recorddefs: compileRecorddefs([sf1Recorddefs as RecorddefsJson]),
  records: STARFIELD_RECORD_LAYOUT,
  npcReference: noNpcReference,
  functionKeywords: SF1_FUNCTION_KEYWORDS,
  archive: { kind: 'ba2', bsaVersion: 104, ba2Version: 2 },
  strings: {
    lookupOrder: ['loose', 'ba2'],
    officialLocales: SF1_OFFICIAL_LOCALES,
    unofficialSlots: ['en'],
    archiveSuffixes: [' - Localization'],
  },
  // The fonts have no Cyrillic at all; the Japanese set draws Russian Cyrillic in
  // the same faces, so the letters come from there. The extended display face
  // has no counterpart and borrows the bold grotesque, as the Japanese config does.
  interfaceFonts: {
    libraries: ['fonts_{slot}.swf', 'fonts_{slot}.gfx'],
    config: 'fontconfig_{slot}.txt',
    donorLibraries: ['fonts_ja.swf'],
    fallbackFamilies: {
      'Univers LT Std 93 Extra Black Extended': 'NB Grotesk R Bold',
      Arial: 'NB Grotesk R Semibold',
      Consolas: 'NB Architekt',
    },
  },
  addonPluginPrefixes: ['sfbgs', 'sfta', 'blueprintships-sfta'],
  voice: {
    faceFxTitle: 'Starfield',
    packLangpackVoiceIntoBa2: false,
    // The PC game's own takes are Wwise Vorbis (`[Wwise] iDefaultExternalCodecID=4`
    // in Starfield.ini), so new takes are too.
    takes: { kind: 'wem-ffxanim', codec: 'vorbis' },
  },
  deployment: {
    // The plugins the engine loads on its own, in its order (libloadorder's
    // hardcoded list), then the two ship-blueprint masters, which load last.
    officialMasters: [
      'Starfield.esm',
      'Constellation.esm',
      'OldMars.esm',
      'ShatteredSpace.esm',
      'SFBGS003.esm',
      'SFBGS004.esm',
      'SFBGS006.esm',
      'SFBGS007.esm',
      'SFBGS008.esm',
      'SFBGS00D.esm',
      'SFBGS047.esm',
      'SFBGS050.esm',
      'BlueprintShips-Starfield.esm',
      'BlueprintShips-SFBGS050.esm',
    ],
    localAppFolder: 'Starfield',
    vortexId: 'starfield',
    exeName: 'Starfield.exe',
  },
  prompts: {
    label: 'Starfield',
    translateUk: () => SF1_UK_TRANSLATE_PROMPT,
    verifyUk: () => SF1_UK_VERIFY_PROMPT,
    rules: sf1Rules,
    glossary: SF1_UK_GLOSSARY,
    english: creationEngineEnglishSections('Starfield'),
  },
};
