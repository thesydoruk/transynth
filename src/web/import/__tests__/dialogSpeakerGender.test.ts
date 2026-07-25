import { genderFromVoiceTypeHeuristic, genderFromVoiceTypeName } from '../../../dialog';
import type { ActorRecord, VoiceTypeRecord } from '../../../formats/types';
import { mergeActorIndexes } from '../dialogSpeakers/masterPlugins';
import {
  buildPluginSpeakerIndex,
  genderFromVoiceTypeIndex,
} from '../dialogSpeakers/pluginSpeakerIndex';
import { buildDialogSpeakerRows } from '../dialogSpeakers/speakerRows';

const voiceType = (edid: string, isFemale: boolean | null): VoiceTypeRecord => ({
  formId: edid.toUpperCase().padEnd(8, '0').slice(0, 8),
  edid,
  isFemale,
});

const makeIndex = (voiceTypes: VoiceTypeRecord[], voiceFolders = new Map<string, string>()) =>
  buildPluginSpeakerIndex({
    actorIndex: { actors: [], voiceTypes },
    englishStrings: null,
    npcReferenceNames: new Map(),
    voiceFolders,
  });

describe('genderFromVoiceTypeName', () => {
  it.each([
    ['NPCFPiper', 'female'],
    ['FemaleBoston', 'female'],
    ['MaleBoston', 'male'],
    ['PlayerVoiceFemale01', 'any'],
  ])('reads the Creation Kit convention: %s', (name, expected) => {
    expect(genderFromVoiceTypeName(name)).toBe(expected);
  });

  it.each([
    ['DLC04NPCMGage', 'male'],
    ['DLC01NPCFMechanist', 'female'],
  ])('finds the marker behind an add-on prefix: %s', (name, expected) => {
    expect(genderFromVoiceTypeName(name)).toBe(expected);
  });

  it('prefers the spelled-out word to a marker matched mid-name', () => {
    expect(genderFromVoiceTypeName('FemaleNPCMisc')).toBe('female');
  });

  it('says nothing about a custom voice with no gender hint', () => {
    expect(genderFromVoiceTypeName('DP_RoxyVoice')).toBe('unknown');
  });
});

describe('genderFromVoiceTypeHeuristic', () => {
  it.each([
    ['CrFeralGhoul', 'male'],
    ['CrSuperMutant', 'male'],
    ['RobotMrHandy', 'male'],
    ['DLC01RobotRobobrain', 'male'],
    ['TurretVoice', 'male'],
  ])('defaults non-human voices to masculine agreement: %s', (name, expected) => {
    expect(genderFromVoiceTypeHeuristic(name)).toBe(expected);
  });

  it('treats robot folders as male when only the heuristic runs', () => {
    expect(genderFromVoiceTypeHeuristic('FemaleRobotTest')).toBe('male');
  });
});

describe('genderFromVoiceTypeIndex', () => {
  it('falls back to the DNAM flag when the name is silent', () => {
    const index = makeIndex([voiceType('DP_RoxyVoice', true), voiceType('DP_MurphyVoice', false)]);

    expect(genderFromVoiceTypeIndex(index, 'DP_RoxyVoice')).toEqual({
      gender: 'female',
      source: 'voice_type_flag',
    });
    expect(genderFromVoiceTypeIndex(index, 'DP_MurphyVoice')).toEqual({
      gender: 'male',
      source: 'voice_type_flag',
    });
  });

  it('genders robots the flag marks as female', () => {
    const index = makeIndex([voiceType('RobotPAM', true), voiceType('RobotMrHandy', false)]);

    expect(genderFromVoiceTypeIndex(index, 'RobotPAM').gender).toBe('female');
    expect(genderFromVoiceTypeIndex(index, 'RobotMrHandy').gender).toBe('male');
  });

  it('keeps the name when a vanilla record carries the wrong flag', () => {
    const index = makeIndex([voiceType('NPCFProctorIngram', false)]);

    expect(genderFromVoiceTypeIndex(index, 'NPCFProctorIngram')).toEqual({
      gender: 'female',
      source: 'voice_type',
    });
  });

  it('reads a folder whose voice type this plugin does not define', () => {
    expect(genderFromVoiceTypeIndex(makeIndex([]), 'FemaleBoston')).toEqual({
      gender: 'female',
      source: 'voice_type',
    });
  });

  it('stays unknown without a name hint, flag, or creature pattern', () => {
    const index = makeIndex([voiceType('DP_EdenVoice', null)]);

    expect(genderFromVoiceTypeIndex(index, 'DP_EdenVoice')).toEqual({
      gender: 'unknown',
      source: null,
    });
  });

  it('uses creature naming when the plugin has no VTYP record', () => {
    expect(genderFromVoiceTypeIndex(makeIndex([]), 'CrFeralGhoul')).toEqual({
      gender: 'male',
      source: 'voice_type_heuristic',
    });
  });

  it('uses creature naming when the VTYP record has no flag', () => {
    const index = makeIndex([voiceType('CrFeralGhoul', null)]);

    expect(genderFromVoiceTypeIndex(index, 'CrFeralGhoul')).toEqual({
      gender: 'male',
      source: 'voice_type_heuristic',
    });
  });
});

describe('buildDialogSpeakerRows', () => {
  it('genders a voice-folder speaker from the flag of its voice type', () => {
    const index = makeIndex(
      [voiceType('DP_RoxyVoice', true)],
      new Map([['0012AB', 'DP_RoxyVoice']]),
    );

    const rows = buildDialogSpeakerRows({
      nodes: [
        { speaker_key: 'voice:DP_RoxyVoice', speaker_name: null, info_formid_hex: '000012AB' },
      ],
      index,
      playerSpeakerKeys: new Set(),
    });

    expect(rows).toEqual([
      {
        speakerKey: 'voice:DP_RoxyVoice',
        displayName: 'Roxy',
        voiceType: 'DP_RoxyVoice',
        isPlayer: false,
        detectedGender: 'female',
        detectedSource: 'voice_type_flag',
      },
    ]);
  });

  it('keeps the ACBS flag of an actor the plugin defines', () => {
    const actor: ActorRecord = {
      formId: '000ABCDE',
      edid: 'CompanionCurie',
      isFemale: true,
      voiceTypeFormId: null,
      nameLStringId: null,
      nameText: 'Curie',
    };
    const index = buildPluginSpeakerIndex({
      actorIndex: { actors: [actor], voiceTypes: [] },
      englishStrings: null,
      npcReferenceNames: new Map(),
      voiceFolders: new Map(),
    });

    const rows = buildDialogSpeakerRows({
      nodes: [{ speaker_key: 'npc:000ABCDE', speaker_name: null, info_formid_hex: '00001111' }],
      index,
      playerSpeakerKeys: new Set(),
    });

    expect(rows[0]).toMatchObject({
      displayName: 'Curie',
      detectedGender: 'female',
      detectedSource: 'plugin',
    });
  });
});

describe('mergeActorIndexes', () => {
  it('pulls voice types from masters while the plugin wins on conflicts', () => {
    const merged = mergeActorIndexes([
      { actors: [], voiceTypes: [voiceType('RobotMrHandy', true)] },
      {
        actors: [],
        voiceTypes: [voiceType('RobotMrHandy', false), voiceType('DLC04NPCMGage', false)],
      },
    ]);

    const index = makeIndex(merged.voiceTypes);
    expect(genderFromVoiceTypeIndex(index, 'RobotMrHandy').gender).toBe('male');
    expect(genderFromVoiceTypeIndex(index, 'DLC04NPCMGage').gender).toBe('male');
  });
});
