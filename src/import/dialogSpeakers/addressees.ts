/**
 * Work out who each dialog node is addressed to, and recover speakers the
 * plugin did not name.
 *
 * Topic dialog is player-facing by construction: the player picks a prompt and
 * the NPC answers them. Two things complicate that.
 *
 * Lines the *player* speaks are also topic dialog, and they are not addressed
 * to the player — they go to whoever owns the conversation. Marking them
 * `player` tells the translator that both sides have a runtime-chosen gender,
 * and the result is a line hedged on both ends for no reason.
 *
 * Scenes are the other case: they play out between quest aliases, the player is
 * only one possible participant, and many of their lines carry no speaker at
 * all. An alias that is named on one of its lines names the rest of them too.
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

/** A node whose speaker the scene graph could name after the fact. */
export type RecoveredNodeSpeaker = {
  nodeId: number;
  speakerKey: string;
};

export type AddresseeResolution = {
  addressees: NodeAddressee[];
  /** Speaker keys that turned out to be the player character. */
  playerSpeakerKeys: Set<string>;
  /** Speaker-less nodes their scene alias could name. */
  recoveredSpeakers: RecoveredNodeSpeaker[];
};

type SceneAliases = Map<number, Map<number, string[]>>;

/** Most frequent value, or null for an empty list. Ties resolve to the first seen. */
const dominant = (values: readonly string[]): string | null => {
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
  const assignment = new Map<number, { sceneId: number; aliasId: number }>();

  for (const phase of [...phases].sort(
    (a, b) => a.scene_id - b.scene_id || a.phase_order - b.phase_order,
  )) {
    for (const node of nodesByTopic.get(phase.topic_id) ?? []) {
      if (assignment.has(node.id)) continue;
      assignment.set(node.id, { sceneId: phase.scene_id, aliasId: phase.alias_id });
    }
  }

  return assignment;
};

/** Is every speaker this alias was seen with the player character? */
const aliasIsPlayer = (
  aliasId: number,
  keys: readonly string[],
  playerKeys: ReadonlySet<string>,
): boolean =>
  aliasId === PLAYER_ALIAS_ID || (keys.length > 0 && keys.every((key) => playerKeys.has(key)));

const addresseeForSceneTurn = (
  aliases: Map<number, string[]>,
  aliasId: number,
  playerKeys: ReadonlySet<string>,
): { kind: AddresseeKind; speakerKey: string | null } => {
  const speaking = aliasIsPlayer(aliasId, aliases.get(aliasId) ?? [], playerKeys);
  const others = [...aliases.keys()].filter((id) => id !== aliasId);
  const counterparts = others.filter((id) => !aliasIsPlayer(id, aliases.get(id) ?? [], playerKeys));

  // Companion idle / one-alias scene: the player is the implicit audience.
  if (!speaking && others.length === 0) {
    return { kind: 'player', speakerKey: null };
  }

  // The player is in the scene and someone else is talking: they are the audience.
  if (!speaking && counterparts.length < others.length) {
    return { kind: 'player', speakerKey: null };
  }
  if (counterparts.length === 1) {
    return { kind: 'npc', speakerKey: dominant(aliases.get(counterparts[0]!) ?? []) };
  }
  return { kind: 'unknown', speakerKey: null };
};

/**
 * Addressee of a node outside any scene.
 *
 * Ordinary topic dialog is an exchange between the player and one NPC, so the
 * addressee is simply the other side. When the player is speaking, the other
 * side is whoever else answers in the same topic.
 */
const addresseeForTopicTurn = (
  node: SpeakerNodeRow,
  topicSpeakers: readonly string[],
  playerKeys: ReadonlySet<string>,
): { kind: AddresseeKind; speakerKey: string | null } => {
  if (!node.speaker_key || !playerKeys.has(node.speaker_key)) {
    return { kind: 'player', speakerKey: null };
  }

  const counterpart = dominant(topicSpeakers.filter((key) => !playerKeys.has(key)));
  return counterpart
    ? { kind: 'npc', speakerKey: counterpart }
    : { kind: 'unknown', speakerKey: null };
};

/**
 * Resolve the addressee of every dialog node of one mod, and name the speakers
 * a scene alias can account for.
 *
 * @param nodes - Every dialog node, with the speaker key resolved at import.
 * @param phases - Scene phases linking scenes and aliases to dialog topics.
 * @param knownPlayerKeys - Speaker keys already known to be the player, from
 * player voice types and actor records. Scene aliases add to this set.
 */
export const resolveNodeAddressees = (
  nodes: SpeakerNodeRow[],
  phases: ScenePhaseRow[],
  knownPlayerKeys: ReadonlySet<string> = new Set(),
): AddresseeResolution => {
  const nodesByTopic = new Map<number, SpeakerNodeRow[]>();
  for (const node of nodes) {
    const bucket = nodesByTopic.get(node.topic_id);
    if (bucket) bucket.push(node);
    else nodesByTopic.set(node.topic_id, [node]);
  }

  const sceneAliases = collectSceneAliases(nodesByTopic, phases);
  const nodeScenes = assignNodesToScenes(nodesByTopic, phases);

  const playerSpeakerKeys = new Set(knownPlayerKeys);
  for (const aliases of sceneAliases.values()) {
    for (const key of aliases.get(PLAYER_ALIAS_ID) ?? []) playerSpeakerKeys.add(key);
  }

  const recoveredSpeakers: RecoveredNodeSpeaker[] = [];
  const addressees = nodes.map<NodeAddressee>((node) => {
    const scene = nodeScenes.get(node.id);
    const aliases = scene ? sceneAliases.get(scene.sceneId) : undefined;

    if (scene && aliases) {
      if (!node.speaker_key) {
        const own = dominant(aliases.get(scene.aliasId) ?? []);
        if (own) recoveredSpeakers.push({ nodeId: node.id, speakerKey: own });
      }
      const resolved = addresseeForSceneTurn(aliases, scene.aliasId, playerSpeakerKeys);
      return { nodeId: node.id, kind: resolved.kind, speakerKey: resolved.speakerKey };
    }

    const topicSpeakers = (nodesByTopic.get(node.topic_id) ?? [])
      .map((sibling) => sibling.speaker_key)
      .filter((key): key is string => key != null);
    const resolved = addresseeForTopicTurn(node, topicSpeakers, playerSpeakerKeys);
    return { nodeId: node.id, kind: resolved.kind, speakerKey: resolved.speakerKey };
  });

  return { addressees, playerSpeakerKeys, recoveredSpeakers };
};
