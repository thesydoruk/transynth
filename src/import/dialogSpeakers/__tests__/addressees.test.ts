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

describe('player identification', () => {
  it('reports the keys a scene alias proved to be the player', () => {
    const nodes = [node(1, 10, 'voice:SomeoneElse')];
    const phases = [phase(1, 0, -2, 10)];

    const result = resolveNodeAddressees(nodes, phases);
    expect([...result.playerSpeakerKeys]).toEqual(['voice:SomeoneElse']);
  });

  it('keeps the keys the caller already knew about', () => {
    const result = resolveNodeAddressees([node(1, 10, 'npc:AAA')], [], new Set(['voice:Player']));
    expect(result.playerSpeakerKeys.has('voice:Player')).toBe(true);
  });
});
