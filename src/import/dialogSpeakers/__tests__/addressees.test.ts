import { describe, expect, it } from '@jest/globals';
import { resolveNodeAddressees, type ScenePhaseRow, type SpeakerNodeRow } from '../addressees';

const node = (id: number, topicId: number, speakerKey: string | null): SpeakerNodeRow => ({
  id,
  topic_id: topicId,
  speaker_key: speakerKey,
});

const phase = (
  sceneId: number,
  order: number,
  aliasId: number,
  topicId: number,
): ScenePhaseRow => ({
  scene_id: sceneId,
  phase_order: order,
  alias_id: aliasId,
  topic_id: topicId,
});

const byNode = (result: ReturnType<typeof resolveNodeAddressees>) =>
  new Map(result.addressees.map((a) => [a.nodeId, a]));

describe('topic dialog', () => {
  it('addresses an NPC line to the player', () => {
    const result = resolveNodeAddressees([node(1, 10, 'npc:AAA')], []);
    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'player', speakerKey: null });
  });

  it('addresses a player line to the NPC who answers in the same topic', () => {
    const nodes = [node(1, 10, 'voice:PlayerVoiceMale01'), node(2, 10, 'npc:AAA')];
    const result = resolveNodeAddressees(nodes, [], new Set(['voice:PlayerVoiceMale01']));

    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'npc', speakerKey: 'npc:AAA' });
    expect(byNode(result).get(2)).toEqual({ nodeId: 2, kind: 'player', speakerKey: null });
  });

  it('leaves the addressee unknown when the player has nobody to talk to', () => {
    const result = resolveNodeAddressees(
      [node(1, 10, 'voice:PlayerVoiceMale01')],
      [],
      new Set(['voice:PlayerVoiceMale01']),
    );
    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'unknown', speakerKey: null });
  });
});

describe('scene dialog', () => {
  it('addresses an NPC turn to the player when the player is in the scene', () => {
    const nodes = [node(1, 10, 'npc:AAA'), node(2, 11, 'voice:PlayerVoiceMale01')];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, -2, 11)];

    const result = resolveNodeAddressees(nodes, phases);
    expect(byNode(result).get(1)?.kind).toBe('player');
  });

  it('addresses a two-NPC scene turn to the other alias', () => {
    const nodes = [node(1, 10, 'npc:AAA'), node(2, 11, 'npc:BBB')];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, 6, 11)];

    const result = resolveNodeAddressees(nodes, phases);
    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'npc', speakerKey: 'npc:BBB' });
    expect(byNode(result).get(2)).toEqual({ nodeId: 2, kind: 'npc', speakerKey: 'npc:AAA' });
  });

  it('addresses a one-alias scene to the player', () => {
    const nodes = [node(1, 10, 'npc:ADA')];
    const phases = [phase(1, 0, 5, 10)];

    expect(byNode(resolveNodeAddressees(nodes, phases)).get(1)?.kind).toBe('player');
  });

  it('gives up when three parties could be the audience', () => {
    const nodes = [node(1, 10, 'npc:AAA'), node(2, 11, 'npc:BBB'), node(3, 12, 'npc:CCC')];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, 6, 11), phase(1, 2, 7, 12)];

    expect(byNode(resolveNodeAddressees(nodes, phases)).get(1)?.kind).toBe('unknown');
  });
});

describe('speaker recovery', () => {
  it('names a speaker-less node from another line of the same alias', () => {
    const nodes = [node(1, 10, 'npc:AAA'), node(2, 11, null)];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, 5, 11)];

    const result = resolveNodeAddressees(nodes, phases);
    expect(result.recoveredSpeakers).toEqual([{ nodeId: 2, speakerKey: 'npc:AAA' }]);
  });

  it('recovers nothing when the alias is anonymous throughout', () => {
    const nodes = [node(1, 10, null), node(2, 11, null)];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, 5, 11)];

    expect(resolveNodeAddressees(nodes, phases).recoveredSpeakers).toEqual([]);
  });

  it('leaves a node that already has a speaker alone', () => {
    const nodes = [node(1, 10, 'npc:AAA'), node(2, 11, 'npc:BBB')];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, 5, 11)];

    expect(resolveNodeAddressees(nodes, phases).recoveredSpeakers).toEqual([]);
  });
});

describe('a speaker heard under the player alias', () => {
  // Inst308HolotapeShaun: five `radio` actions on alias -2, every line Father's.
  const holotape = [phase(1, 0, -2, 10), phase(1, 1, -2, 11)];
  const tapeNodes = [node(1, 10, 'npc:FATHER'), node(2, 11, 'npc:FATHER')];

  it('stays an NPC in ordinary topic dialog', () => {
    const nodes = [...tapeNodes, node(3, 20, 'npc:FATHER')];

    const result = resolveNodeAddressees(nodes, holotape);
    expect(byNode(result).get(3)).toEqual({ nodeId: 3, kind: 'player', speakerKey: null });
  });

  it('stays the counterpart of a scene they share with another NPC', () => {
    const nodes = [...tapeNodes, node(3, 20, 'npc:FATHER'), node(4, 21, 'npc:ALLIE')];
    const phases = [...holotape, phase(2, 0, 5, 20), phase(2, 1, 6, 21)];

    const result = resolveNodeAddressees(nodes, phases);
    expect(byNode(result).get(4)).toEqual({ nodeId: 4, kind: 'npc', speakerKey: 'npc:FATHER' });
    expect(byNode(result).get(3)).toEqual({ nodeId: 3, kind: 'npc', speakerKey: 'npc:ALLIE' });
  });

  it('does not answer a player prompt as the player', () => {
    const nodes = [...tapeNodes, node(3, 20, 'voice:PlayerVoiceMale01'), node(4, 20, 'npc:FATHER')];

    const result = resolveNodeAddressees(nodes, holotape, new Set(['voice:PlayerVoiceMale01']));
    expect(byNode(result).get(3)).toEqual({ nodeId: 3, kind: 'npc', speakerKey: 'npc:FATHER' });
    expect(byNode(result).get(4)).toEqual({ nodeId: 4, kind: 'player', speakerKey: null });
  });

  it('leaves the audience of the recording itself unknown', () => {
    const result = resolveNodeAddressees(tapeNodes, holotape);
    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'unknown', speakerKey: null });
  });

  it('still names a speaker-less line of the same recording', () => {
    const nodes = [node(1, 10, 'npc:FATHER'), node(2, 11, null)];

    const result = resolveNodeAddressees(nodes, holotape);
    expect(result.recoveredSpeakers).toEqual([{ nodeId: 2, speakerKey: 'npc:FATHER' }]);
  });
});

describe('a Player Dialogue action in a scene', () => {
  // The action belongs to the NPC: prompts and answers share its alias and phase.
  const PLAYER = 'voice:PlayerVoiceFemale01';
  const players = new Set([PLAYER]);

  it('addresses the prompt to the NPC and the answer to the player', () => {
    const nodes = [node(1, 10, PLAYER), node(2, 11, 'npc:PIPER')];
    const phases = [phase(1, 0, 5, 10), phase(1, 0, 5, 11)];

    const result = resolveNodeAddressees(nodes, phases, players);
    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'npc', speakerKey: 'npc:PIPER' });
    expect(byNode(result).get(2)).toEqual({ nodeId: 2, kind: 'player', speakerKey: null });
  });

  // COMCurieQuest_200_AmariMeeting: the player talks to Amari while Curie stands by.
  const amariScene = [
    phase(1, 0, 5, 10),
    phase(1, 0, 5, 11),
    phase(1, 1, 6, 12),
    phase(1, 2, 5, 13),
    phase(1, 3, 5, 14),
  ];
  const amariNodes = [
    node(1, 10, PLAYER),
    node(2, 11, 'npc:AMARI'),
    node(3, 12, 'npc:CURIE'),
    node(4, 13, 'npc:AMARI'),
    node(5, 14, 'npc:AMARI'),
  ];

  it('keeps the exchange between the player and its NPC when a second NPC is in the scene', () => {
    const result = resolveNodeAddressees(amariNodes, amariScene, players);

    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'npc', speakerKey: 'npc:AMARI' });
    expect(byNode(result).get(2)).toEqual({ nodeId: 2, kind: 'player', speakerKey: null });
  });

  it('leaves the lines outside the exchange to the alias rules', () => {
    const result = resolveNodeAddressees(amariNodes, amariScene, players);

    expect(byNode(result).get(3)).toEqual({ nodeId: 3, kind: 'npc', speakerKey: 'npc:AMARI' });
    expect(byNode(result).get(4)).toEqual({ nodeId: 4, kind: 'npc', speakerKey: 'npc:CURIE' });
  });

  it('finds the NPC of a prompt among three aliases', () => {
    const nodes = [...amariNodes, node(6, 15, 'npc:GLORY')];
    const phases = [...amariScene, phase(1, 4, 7, 15)];

    const result = resolveNodeAddressees(nodes, phases, players);
    expect(byNode(result).get(1)).toEqual({ nodeId: 1, kind: 'npc', speakerKey: 'npc:AMARI' });
    expect(byNode(result).get(6)?.kind).toBe('unknown');
  });

  it('never names the player as an NPC addressee', () => {
    // Travis's alias holds more prompts than lines of his own; Piper remarks from hers.
    const nodes = [
      node(1, 10, PLAYER),
      node(2, 11, PLAYER),
      node(3, 12, 'npc:TRAVIS'),
      node(4, 13, 'npc:PIPER'),
    ];
    const phases = [phase(1, 0, 5, 10), phase(1, 0, 5, 11), phase(1, 0, 5, 12), phase(1, 1, 6, 13)];

    const result = resolveNodeAddressees(nodes, phases, players);
    expect(byNode(result).get(4)).toEqual({ nodeId: 4, kind: 'player', speakerKey: null });
  });

  it('names the NPC, not the prompts, when the player speaks from their own alias', () => {
    const nodes = [
      node(1, 10, PLAYER),
      node(2, 11, PLAYER),
      node(3, 12, 'npc:TRAVIS'),
      node(4, 13, PLAYER),
    ];
    const phases = [
      phase(1, 0, 5, 10),
      phase(1, 0, 5, 11),
      phase(1, 0, 5, 12),
      phase(1, 1, -2, 13),
    ];

    const result = resolveNodeAddressees(nodes, phases, players);
    expect(byNode(result).get(4)).toEqual({ nodeId: 4, kind: 'npc', speakerKey: 'npc:TRAVIS' });
  });

  it('leaves a speaker-less line of the action to the alias rules', () => {
    const nodes = [node(1, 10, PLAYER), node(2, 11, 'npc:PIPER'), node(3, 12, null)];
    const phases = [phase(1, 0, 5, 10), phase(1, 0, 5, 11), phase(1, 0, 5, 12)];

    const result = resolveNodeAddressees(nodes, phases, players);
    expect(byNode(result).get(3)).toEqual({ nodeId: 3, kind: 'player', speakerKey: null });
  });
});

describe('player identification', () => {
  it('takes the player from the caller alone', () => {
    const nodes = [node(1, 10, 'voice:PlayerVoiceMale01'), node(2, 11, 'npc:AAA')];
    const phases = [phase(1, 0, 5, 10), phase(1, 1, 6, 11)];

    const unknownPlayer = resolveNodeAddressees(nodes, phases);
    expect(byNode(unknownPlayer).get(2)?.kind).toBe('npc');

    const knownPlayer = resolveNodeAddressees(nodes, phases, new Set(['voice:PlayerVoiceMale01']));
    expect(byNode(knownPlayer).get(2)).toEqual({ nodeId: 2, kind: 'player', speakerKey: null });
  });
});
