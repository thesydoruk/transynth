import {
  formatInheritedFromLabel,
  lookupInheritedVoiceLine,
  type InheritedVoiceLookup,
  type MasterModRef,
} from '../inheritedVoiceText';
import { voiceTranslationMapKey } from '../loadVoiceTranslations';

const masterA: MasterModRef = {
  modId: 10,
  modName: 'Fusion City Rising',
  pluginName: 'AA FusionCityRising.esp',
};

const masterB: MasterModRef = {
  modId: 11,
  modName: 'Fallout 4',
  pluginName: 'Fallout4.esm',
};

describe('lookupInheritedVoiceLine', () => {
  it('returns text from the first master that has a matching NAM1', () => {
    const lookup: InheritedVoiceLookup = {
      masters: [masterA, masterB],
      sourcesByMod: new Map([
        [
          masterA.modId,
          new Map([
            [
              voiceTranslationMapKey('0067F7', 1),
              { source: 'Parent line', infoFormidHex: '030067F7' },
            ],
          ]),
        ],
        [masterB.modId, new Map()],
      ]),
      translationsByMod: new Map([
        [masterA.modId, new Map()],
        [masterB.modId, new Map()],
      ]),
    };

    const hit = lookupInheritedVoiceLine(lookup, '0067F7', 1);
    expect(hit?.source).toBe('Parent line');
    expect(hit?.master.modId).toBe(masterA.modId);
    expect(hit?.infoFormidHex).toBe('030067F7');
  });

  it('falls back to the next master when the first has no match', () => {
    const lookup: InheritedVoiceLookup = {
      masters: [masterA, masterB],
      sourcesByMod: new Map([
        [masterA.modId, new Map()],
        [
          masterB.modId,
          new Map([
            [
              voiceTranslationMapKey('008EC5', 1),
              { source: 'Vanilla line', infoFormidHex: '00008EC5' },
            ],
          ]),
        ],
      ]),
      translationsByMod: new Map([
        [masterA.modId, new Map()],
        [masterB.modId, new Map()],
      ]),
    };

    expect(lookupInheritedVoiceLine(lookup, '008EC5', 1)?.source).toBe('Vanilla line');
  });

  it('includes translation from the same master when available', () => {
    const lookup: InheritedVoiceLookup = {
      masters: [masterA],
      sourcesByMod: new Map([
        [
          masterA.modId,
          new Map([
            [voiceTranslationMapKey('002CBA', 1), { source: 'Hello', infoFormidHex: '03002CBA' }],
          ]),
        ],
      ]),
      translationsByMod: new Map([
        [
          masterA.modId,
          new Map([
            [
              voiceTranslationMapKey('002CBA', 1),
              {
                formidLower6: '002CBA',
                infoFormidHex: '03002CBA',
                voiceVariant: 1,
                source: 'Hello',
                translation: 'Привіт',
                edid: null,
              },
            ],
          ]),
        ],
      ]),
    };

    const hit = lookupInheritedVoiceLine(lookup, '002CBA', 1);
    expect(hit?.translation).toBe('Привіт');
  });
});

describe('formatInheritedFromLabel', () => {
  it('combines mod name and plugin basename', () => {
    expect(formatInheritedFromLabel(masterA)).toBe('Fusion City Rising (AA FusionCityRising.esp)');
  });
});
