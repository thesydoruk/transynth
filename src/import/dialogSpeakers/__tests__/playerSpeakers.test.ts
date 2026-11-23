import { describe, expect, it } from '@jest/globals';
import type { ActorRecord } from '../../../formats/types';
import { resolveNodeAddressees } from '../addressees';
import { buildPluginSpeakerIndex } from '../pluginSpeakerIndex';
import { buildDialogSpeakerRows, markPlayerSpeakers, playerKeysFromRows } from '../speakerRows';

const actor = (formId: string, name: string, isFemale: boolean): ActorRecord => ({
  formId,
  edid: name.replace(/\s/g, ''),
  isFemale,
  voiceTypeFormId: null,
  nameLStringId: null,
  nameText: name,
});

/**
 * Fallout4.esm in miniature: Father records a holotape (`Inst308HolotapeShaun`,
 * `radio` actions on the player alias) and Jezebel talks out of the player's
 * inventory (`dialogue` actions on the player alias). Both name themselves on
 * every line. The player answers through a player voice folder.
 */
const index = buildPluginSpeakerIndex({
  actorIndex: {
    actors: [actor('0002A19A', 'Father', false), actor('01008ACF', 'Jezebel', true)],
    voiceTypes: [],
  },
  englishStrings: null,
  npcReferenceNames: new Map(),
  voiceFolders: new Map([['00AAA3', 'PlayerVoiceFemale01']]),
});

const line = (id: number, topicId: number, speakerKey: string, info: string) => ({
  id,
  topic_id: topicId,
  speaker_key: speakerKey,
  speaker_name: null,
  info_formid_hex: info,
});

const nodes = [
  line(1, 10, 'npc:0002A19A', '0000AAA1'),
  line(2, 11, 'npc:01008ACF', '0000AAA2'),
  line(3, 12, 'voice:PlayerVoiceFemale01', '0000AAA3'),
  // Outside any scene: the player asks, Father answers.
  line(4, 20, 'voice:PlayerVoiceFemale01', '0000AAA3'),
  line(5, 20, 'npc:0002A19A', '0000AAA4'),
];

const phases = [
  { scene_id: 1, phase_order: 0, alias_id: -2, topic_id: 10 },
  { scene_id: 2, phase_order: 0, alias_id: -2, topic_id: 11 },
  { scene_id: 3, phase_order: 0, alias_id: -2, topic_id: 12 },
];

describe('speakers heard under the player alias', () => {
  const fromPlugin = buildDialogSpeakerRows({ nodes, index });
  const rows = markPlayerSpeakers(fromPlugin);
  const byKey = new Map(rows.map((row) => [row.speakerKey, row]));

  it('keeps an NPC recorded on a holotape an NPC of their own sex', () => {
    expect(byKey.get('npc:0002A19A')).toMatchObject({
      displayName: 'Father',
      isPlayer: false,
      detectedGender: 'male',
      detectedSource: 'plugin',
    });
  });

  it('keeps an NPC who talks through the player an NPC of their own sex', () => {
    expect(byKey.get('npc:01008ACF')).toMatchObject({
      isPlayer: false,
      detectedGender: 'female',
      detectedSource: 'plugin',
    });
  });

  it('knows the player by the voice folder of their lines', () => {
    expect(byKey.get('voice:PlayerVoiceFemale01')).toMatchObject({
      isPlayer: true,
      detectedGender: 'any',
      detectedSource: 'player',
    });
    expect([...playerKeysFromRows(fromPlugin)]).toEqual(['voice:PlayerVoiceFemale01']);
  });

  it('addresses the recorded NPC as the one the player talks to', () => {
    const { addressees } = resolveNodeAddressees(nodes, phases, playerKeysFromRows(fromPlugin));
    const byNode = new Map(addressees.map((a) => [a.nodeId, a]));

    expect(byNode.get(4)).toEqual({ nodeId: 4, kind: 'npc', speakerKey: 'npc:0002A19A' });
    expect(byNode.get(5)).toEqual({ nodeId: 5, kind: 'player', speakerKey: null });
  });
});

describe('markPlayerSpeakers', () => {
  it('forces the shared player key to a runtime-chosen gender', () => {
    const [row] = markPlayerSpeakers([
      {
        speakerKey: 'player',
        displayName: 'You',
        voiceType: null,
        isPlayer: false,
        detectedGender: 'unknown',
        detectedSource: null,
      },
    ]);
    expect(row).toMatchObject({ isPlayer: true, detectedGender: 'any', detectedSource: 'player' });
  });
});
