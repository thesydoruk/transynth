import type { ActorRecord, VoiceTypeRecord } from '../../../formats/types';
import { buildActorSpeakerRowsFromIndex } from '../actorSpeakerRows';
import { buildPluginSpeakerIndex } from '../pluginSpeakerIndex';
import { buildDialogSpeakerRows, playerKeysFromRows } from '../speakerRows';

/** Records as Fallout4.esm ships them: FormIDs, sex flags and voice types. */
const VOICE_TYPES: VoiceTypeRecord[] = [
  { formId: '00018DF4', edid: 'PlayerVoiceMale01', isFemale: false },
  { formId: '00018DF7', edid: 'PlayerVoiceFemale01', isFemale: true },
  { formId: '0001928A', edid: 'NPCFPiper', isFemale: true },
];

const actor = (
  formId: string,
  edid: string,
  isFemale: boolean,
  voiceTypeFormId: string | null,
): ActorRecord => ({
  formId,
  edid,
  isFemale,
  voiceTypeFormId,
  nameLStringId: null,
  nameText: null,
});

const PLAYER = actor('00000007', 'Player', false, '00018DF4');
const SPOUSE_MALE = actor('000A7D34', 'MQ101PlayerSpouseMale', false, '00018DF4');
const SPOUSE_FEMALE = actor('000A7D35', 'MQ101PlayerSpouseFemale', true, '00018DF7');
const PIPER = actor('00002F1E', 'CompanionPiper', true, '0001928A');

const makeIndex = (actors: ActorRecord[], voiceFolders = new Map<string, string>()) =>
  buildPluginSpeakerIndex({
    actorIndex: { actors, voiceTypes: VOICE_TYPES },
    englishStrings: null,
    npcReferenceNames: new Map(),
    voiceFolders,
  });

describe('buildPluginSpeakerIndex — the player and actors that share their voice', () => {
  it('names the voice type an actor record points at', () => {
    const index = makeIndex([PIPER]);

    expect(index.actors.get('00002F1E')).toMatchObject({
      gender: 'female',
      source: 'plugin',
      voiceType: 'NPCFPiper',
      isPlayer: false,
    });
  });

  it('reads the player record as the player, whatever sex its ACBS carries', () => {
    const index = makeIndex([PLAYER]);

    expect(index.actors.get('00000007')).toMatchObject({
      gender: 'any',
      source: 'player',
      voiceType: 'PlayerVoiceMale01',
      isPlayer: true,
    });
  });

  it('keeps the sex of an NPC that only borrows the player voice', () => {
    const index = makeIndex([SPOUSE_MALE, SPOUSE_FEMALE]);

    expect(index.actors.get('000A7D34')).toMatchObject({
      gender: 'male',
      source: 'plugin',
      voiceType: 'PlayerVoiceMale01',
      isPlayer: false,
    });
    expect(index.actors.get('000A7D35')).toMatchObject({
      gender: 'female',
      source: 'plugin',
      voiceType: 'PlayerVoiceFemale01',
      isPlayer: false,
    });
  });

  it('carries both through to the speaker rows of their lines', () => {
    const rows = buildDialogSpeakerRows({
      nodes: [
        { speaker_key: 'npc:00000007', speaker_name: null, info_formid_hex: '00001111' },
        { speaker_key: 'npc:000A7D34', speaker_name: null, info_formid_hex: '00002222' },
      ],
      index: makeIndex([PLAYER, SPOUSE_MALE]),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        speakerKey: 'npc:00000007',
        isPlayer: true,
        detectedGender: 'any',
        detectedSource: 'player',
      }),
      expect.objectContaining({
        speakerKey: 'npc:000A7D34',
        isPlayer: false,
        detectedGender: 'male',
        detectedSource: 'plugin',
      }),
    ]);
    expect(playerKeysFromRows(rows)).toEqual(new Set(['npc:00000007']));
  });
});

describe('the voice type a speaker row stores', () => {
  // NPC_ 0015384E: his record names NPCMScottEdwards, his lines ship in MaleEvenToned.
  const EDWARDS = actor('0015384E', 'ScottEdwards', false, '0015384F');
  const index = buildPluginSpeakerIndex({
    actorIndex: {
      actors: [EDWARDS, PIPER],
      voiceTypes: [
        ...VOICE_TYPES,
        { formId: '0015384F', edid: 'NPCMScottEdwards', isFemale: false },
      ],
    },
    englishStrings: null,
    npcReferenceNames: new Map(),
    voiceFolders: new Map([['00AAAA', 'MaleEvenToned']]),
  });

  it('is the folder the audio was found in, when there is one', () => {
    const [row] = buildDialogSpeakerRows({
      nodes: [{ speaker_key: 'npc:0015384E', speaker_name: null, info_formid_hex: '0000AAAA' }],
      index,
    });

    expect(row).toMatchObject({ voiceType: 'MaleEvenToned', detectedGender: 'male' });
  });

  it('falls back to the voice type of the actor record for a line with no audio', () => {
    const [row] = buildDialogSpeakerRows({
      nodes: [{ speaker_key: 'npc:00002F1E', speaker_name: null, info_formid_hex: '0000BBBB' }],
      index,
    });

    expect(row).toMatchObject({ voiceType: 'NPCFPiper', detectedGender: 'female' });
  });

  it('stays empty for an actor with no line in the mod', () => {
    const rows = buildActorSpeakerRowsFromIndex(index, new Set(['npc:0015384E']));

    expect(rows).toEqual([
      expect.objectContaining({
        speakerKey: 'npc:00002F1E',
        voiceType: null,
        detectedGender: 'female',
      }),
    ]);
  });
});
