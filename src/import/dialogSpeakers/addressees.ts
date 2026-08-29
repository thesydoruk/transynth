/**
 * Work out who each dialog node is addressed to.
 *
 * Topic dialog is player-facing by construction: the player picks a prompt and
 * the NPC answers them. Scenes are different — they play out between quest
 * aliases, and the player is only one possible participant, so the addressee
 * has to be read off the other aliases taking part in the same scene.
 */
import type { AddresseeKind } from '../../dialog';

/** Quest alias id reserved for the player character. */
const PLAYER_ALIAS_ID = -2;

export type SpeakerNodeRow = {
  id: number;
  topic_id: number;
  speaker_key: string | null;
};

export type ScenePhaseRow = {
  scene_id: number;
  phase_order: number;
  alias_id: number;
  topic_id: number;
};

export type NodeAddressee = {
  nodeId: number;
  kind: AddresseeKind;
  speakerKey: string | null;
};

export type AddresseeResolution = {
  addressees: NodeAddressee[];
  /** Speaker keys that turned out to be the player character. */
  playerSpeakerKeys: Set<string>;
};

type SceneAliases = Map<number, Map<number, string[]>>;

/** Most frequent value, or null for an empty list. Ties resolve to the first seen. */
const dominant = (values: string[]): string | null => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

/** Collect, per scene and alias, the speaker keys of every node the alias speaks. */
const collectSceneAliases = (
  nodesByTopic: Map<number, SpeakerNodeRow[]>,
  phases: ScenePhaseRow[],
): SceneAliases => {
  const scenes: SceneAliases = new Map();

  for (const phase of phases) {
    let aliases = scenes.get(phase.scene_id);
    if (!aliases) {
      aliases = new Map();
      scenes.set(phase.scene_id, aliases);
    }
    const keys = aliases.get(phase.alias_id) ?? [];
    for (const node of nodesByTopic.get(phase.topic_id) ?? []) {
      if (node.speaker_key) keys.push(node.speaker_key);
    }
    aliases.set(phase.alias_id, keys);
  }

  return scenes;
};

/**
 * Pick the scene turn each node belongs to.
 *
 * One topic can be replayed by several scenes; the lowest scene and phase wins
 * so a re-import produces the same attribution every time.
 */
const assignNodesToScenes = (
  nodesByTopic: Map<number, SpeakerNodeRow[]>,
  phases: ScenePhaseRow[],
): Map<number, { sceneId: number; aliasId: number }> => {
  const assignment = new Map<number, { sceneId: number; aliasId: number; order: number }>();

  for (const phase of [...phases].sort(
    (a, b) => a.scene_id - b.scene_id || a.phase_order - b.phase_order,
  )) {
    for (const node of nodesByTopic.get(phase.topic_id) ?? []) {
      if (assignment.has(node.id)) continue;
      assignment.set(node.id, {
        sceneId: phase.scene_id,
        aliasId: phase.alias_id,
        order: phase.phase_order,
      });
    }
  }

  return new Map(
    [...assignment].map(([nodeId, value]) => [
      nodeId,
      { sceneId: value.sceneId, aliasId: value.aliasId },
    ]),
  );
};

const addresseeForSceneTurn = (
  aliases: Map<number, string[]>,
  aliasId: number,
): { kind: AddresseeKind; speakerKey: string | null } => {
  const others = [...aliases.keys()].filter((id) => id !== aliasId);

  if (aliasId !== PLAYER_ALIAS_ID && others.includes(PLAYER_ALIAS_ID)) {
    return { kind: 'player', speakerKey: null };
  }

  const counterparts = others.filter((id) => id !== PLAYER_ALIAS_ID);
  if (counterparts.length === 1) {
    return { kind: 'npc', speakerKey: dominant(aliases.get(counterparts[0]!) ?? []) };
  }

  return { kind: 'unknown', speakerKey: null };
};

/**
 * Resolve the addressee of every dialog node of one mod.
 *
 * @param nodes - Every dialog node, with the speaker key resolved at import.
 * @param phases - Scene phases linking scenes and aliases to dialog topics.
 */
export const resolveNodeAddressees = (
  nodes: SpeakerNodeRow[],
  phases: ScenePhaseRow[],
): AddresseeResolution => {
  const nodesByTopic = new Map<number, SpeakerNodeRow[]>();
  for (const node of nodes) {
    const bucket = nodesByTopic.get(node.topic_id);
    if (bucket) bucket.push(node);
    else nodesByTopic.set(node.topic_id, [node]);
  }

  const sceneAliases = collectSceneAliases(nodesByTopic, phases);
  const nodeScenes = assignNodesToScenes(nodesByTopic, phases);

  const playerSpeakerKeys = new Set<string>();
  for (const aliases of sceneAliases.values()) {
    for (const key of aliases.get(PLAYER_ALIAS_ID) ?? []) playerSpeakerKeys.add(key);
  }

  const addressees = nodes.map<NodeAddressee>((node) => {
    const scene = nodeScenes.get(node.id);
    if (!scene) return { nodeId: node.id, kind: 'player', speakerKey: null };

    const aliases = sceneAliases.get(scene.sceneId);
    if (!aliases) return { nodeId: node.id, kind: 'player', speakerKey: null };

    const resolved = addresseeForSceneTurn(aliases, scene.aliasId);
    return { nodeId: node.id, kind: resolved.kind, speakerKey: resolved.speakerKey };
  });

  return { addressees, playerSpeakerKeys };
};
