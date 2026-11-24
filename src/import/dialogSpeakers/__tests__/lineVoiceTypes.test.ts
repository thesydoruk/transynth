import { describe, expect, it } from '@jest/globals';
import type { ActorRecord, VoiceTypeRecord } from '../../../formats/types';
import {
  collectLineVoiceTypes,
  pickLineVoiceType,
  resolveLineVoiceFolders,
  voiceTypeCharacterNames,
  type LineVoiceTypeSources,
} from '../lineVoiceTypes';
import { buildPluginSpeakerIndex } from '../pluginSpeakerIndex';

const VOICE_TYPES: VoiceTypeRecord[] = [
  { formId: '00005984', edid: 'NPCFSarahMorgan', isFemale: true },
  { formId: '000059A6', edid: 'NPCFAndreja', isFemale: true },
  { formId: '000057BB', edid: 'RobotModelAVasco', isFemale: false },
  { formId: '00000101', edid: 'GenericMale01', isFemale: false },
  { formId: '00000102', edid: 'GenericMale02', isFemale: false },
  { formId: '00000201', edid: 'GenericFemale01', isFemale: true },
  { formId: '00018DF4', edid: 'PlayerVoiceMale01', isFemale: false },
  { formId: '00018DF7', edid: 'PlayerVoiceFemale01', isFemale: true },
];

const actor = (formId: string, voiceTypeFormId: string, name: string): ActorRecord => ({
  formId,
  edid: `Actor${formId}`,
  isFemale: null,
  voiceTypeFormId,
  nameLStringId: null,
  nameText: name,
});

const index = buildPluginSpeakerIndex({
  actorIndex: {
    actors: [
      actor('00005983', '00005984', 'Sarah Morgan'),
      actor('0000A001', '00005984', 'Sarah Morgan'),
      actor('0000A002', '00005984', 'The Emissary'),
      actor('000059A7', '000059A6', 'Andreja'),
      actor('0000A003', '000059A6', 'The Emissary'),
      actor('000057BC', '000057BB', 'Vasco'),
      actor('0000B001', '00000101', 'Citizen'),
      actor('0000B002', '00000101', 'Miner'),
    ],
    voiceTypes: VOICE_TYPES,
  },
  englishStrings: null,
  npcReferenceNames: new Map(),
  voiceFolders: new Map(),
});

const sources = (overrides: Partial<LineVoiceTypeSources>): LineVoiceTypeSources => ({
  listed: new Map(),
  voiceTypeNames: new Map(VOICE_TYPES.map((v) => [v.formId, v.edid])),
  takeFolders: new Map(),
  ...overrides,
});

describe('collectLineVoiceTypes', () => {
  it("prefers a response's own list and falls back to its take folders per response", () => {
    const lines = collectLineVoiceTypes(
      sources({
        listed: new Map([['00012345', [['00005984'], []]]]),
        takeFolders: new Map([
          [
            '012345',
            new Map([
              [1, new Set(['npcfsarahmorgan', 'genericfemale01'])],
              [2, new Set(['npcfandreja'])],
            ]),
          ],
          ['000777', new Map([[1, new Set(['SomeModVoice'])]])],
        ]),
      }),
    );
    // Response 1 listed Sarah only; response 2 listed nothing, so its folder counts.
    // Folder names take the voice type's own spelling where one is known.
    expect(lines.get('012345')).toEqual(['NPCFSarahMorgan', 'NPCFAndreja']);
    expect(lines.get('000777')).toEqual(['SomeModVoice']);
  });

  it('ignores listed voice types it cannot name and uses the folders instead', () => {
    const lines = collectLineVoiceTypes(
      sources({
        listed: new Map([['00012345', [['0F000001']]]]),
        takeFolders: new Map([['012345', new Map([[1, new Set(['GenericMale02'])]])]]),
      }),
    );
    expect(lines.get('012345')).toEqual(['GenericMale02']);
  });

  it("gives the player's scene lines the player's voice types, over their own", () => {
    const lines = collectLineVoiceTypes(
      sources({
        listed: new Map([['0000C001', [['00000101']]]]),
        playerLineKeys: new Set(['00C001', '00C002']),
      }),
    );
    expect(lines.get('00C001')).toEqual(['PlayerVoiceFemale01', 'PlayerVoiceMale01']);
    expect(lines.get('00C002')).toEqual(['PlayerVoiceFemale01', 'PlayerVoiceMale01']);
  });
});

describe('pickLineVoiceType', () => {
  it('keeps a single voice type', () => {
    expect(pickLineVoiceType(['NPCFAndreja'], index)).toBe('NPCFAndreja');
  });

  it('files lines of one sex under the first voice type by name', () => {
    expect(pickLineVoiceType(['GenericMale02', 'RobotModelAVasco', 'GenericMale01'], index)).toBe(
      'GenericMale01',
    );
    expect(pickLineVoiceType(['PlayerVoiceMale01', 'PlayerVoiceFemale01'], index)).toBe(
      'PlayerVoiceFemale01',
    );
  });

  it('files no speaker when the voice types disagree on sex', () => {
    expect(pickLineVoiceType(['GenericMale01', 'GenericFemale01'], index)).toBeNull();
    expect(pickLineVoiceType(['GenericMale01', 'PlayerVoiceMale01'], index)).toBeNull();
    expect(pickLineVoiceType([], index)).toBeNull();
  });
});

describe('voiceTypeCharacterNames', () => {
  it('names a voice type after its one character, or the one its EDID spells', () => {
    const names = voiceTypeCharacterNames(index);
    expect(names.get('npcfsarahmorgan')).toBe('Sarah Morgan');
    expect(names.get('npcfandreja')).toBe('Andreja');
    expect(names.get('robotmodelavasco')).toBe('Vasco');
    // Several roles, none in the name: a generic voice names no one.
    expect(names.has('genericmale01')).toBe(false);
  });
});

describe('resolveLineVoiceFolders', () => {
  it('files each line under one voice type and labels it after its character', () => {
    const { voiceFolders, speakerNames } = resolveLineVoiceFolders(
      sources({
        listed: new Map([
          ['00010001', [['000059A6']]],
          ['00010002', [['00000101', '00000102']]],
          ['00010003', [['00000101', '00000201']]],
        ]),
      }),
      index,
    );
    expect([...voiceFolders]).toEqual([
      ['010001', 'NPCFAndreja'],
      ['010002', 'GenericMale01'],
    ]);
    expect([...speakerNames]).toEqual([
      ['010001', 'Andreja'],
      ['010002', 'Generic Male 01'],
    ]);
  });
});
