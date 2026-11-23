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
 *
 * The player's own alias is the exception: it puts the player in the scene and
 * says nothing about whose voice is heard. A holotape is a scene of `radio`
 * actions played at the player, and an NPC who talks over a radio or out of the
 * player's inventory is a `dialogue` action on the player; each of those lines
 * names its real speaker. So who the player is comes from the caller — a player
 * voice type, the player's actor record — and never from the alias a speaker
 * was heard under.
 *
 * The reverse happens too. A Fallout 4 Player Dialogue action belongs to the
 * NPC the player is talking to: its prompts and that NPC's answers are all
 * filed under the NPC's alias. So inside a scene the speaker of a line decides
 * whose turn it is, not the alias — a prompt is said to the NPC of its alias,
 * and the NPC's lines of the same action answer the player.
 */
import type { AddresseeKind } from '../../dialog';

/**
 * Scene alias of the player character: the action is played on, or at, the
 * player. xEdit reads `-2` as "Player" in every title but Skyrim.
 */
export const PLAYER_ALIAS_ID = -2;

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
  /** Speaker-less nodes their scene alias could name. */
  recoveredSpeakers: RecoveredNodeSpeaker[];
};

type SceneAliases = Map<number, Map<number, string[]>>;

/** Where a node sits in its scene. */
type SceneTurn = { sceneId: number; aliasId: number; phaseOrder: number };

type Addressee = { kind: AddresseeKind; speakerKey: string | null };

const TO_PLAYER: Addressee = { kind: 'player', speakerKey: null };
const TO_UNKNOWN: Addressee = { kind: 'unknown', speakerKey: null };

/** One scene action: every topic it plays shares scene, phase and alias. */
const actionKey = (sceneId: number, phaseOrder: number, aliasId: number): string =>
  `${sceneId}:${phaseOrder}:${aliasId}`;

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
): Map<number, SceneTurn> => {
  const assignment = new Map<number, SceneTurn>();

  for (const phase of [...phases].sort(
    (a, b) => a.scene_id - b.scene_id || a.phase_order - b.phase_order,
  )) {
    for (const node of nodesByTopic.get(phase.topic_id) ?? []) {
      if (assignment.has(node.id)) continue;
      assignment.set(node.id, {
        sceneId: phase.scene_id,
        aliasId: phase.alias_id,
        phaseOrder: phase.phase_order,
      });
    }
  }

  return assignment;
};

/**
 * Collect the actions in which the player is heard under somebody else's alias.
 *
 * Those are the Player Dialogue actions: the phase rows do not say which of an
 * action's topics are prompts and which are answers, but the lines themselves
 * do — a prompt is in the player's voice.
 */
const collectPlayerExchanges = (
  nodesByTopic: Map<number, SpeakerNodeRow[]>,
  phases: ScenePhaseRow[],
  playerKeys: ReadonlySet<string>,
): Set<string> => {
  const exchanges = new Set<string>();

  for (const phase of phases) {
    if (phase.alias_id === PLAYER_ALIAS_ID) continue;
    const playerHeard = (nodesByTopic.get(phase.topic_id) ?? []).some(
      (node) => node.speaker_key != null && playerKeys.has(node.speaker_key),
    );
    if (playerHeard) exchanges.add(actionKey(phase.scene_id, phase.phase_order, phase.alias_id));
  }

  return exchanges;
};

/** Is this the player's alias, or one only the player was heard under? */
const aliasIsPlayer = (
  aliasId: number,
  keys: readonly string[],
  playerKeys: ReadonlySet<string>,
): boolean =>
  aliasId === PLAYER_ALIAS_ID || (keys.length > 0 && keys.every((key) => playerKeys.has(key)));

/** Most frequent speaker who is not the player: the NPC an alias or a topic stands for. */
const dominantNpc = (keys: readonly string[], playerKeys: ReadonlySet<string>): string | null =>
  dominant(keys.filter((key) => !playerKeys.has(key)));

const addresseeForSceneTurn = (
  aliases: Map<number, string[]>,
  turn: SceneTurn,
  node: SpeakerNodeRow,
  playerKeys: ReadonlySet<string>,
  playerExchanges: ReadonlySet<string>,
): Addressee => {
  const ownKeys = aliases.get(turn.aliasId) ?? [];
  const ownIsPlayer = aliasIsPlayer(turn.aliasId, ownKeys, playerKeys);

  if (!ownIsPlayer && node.speaker_key != null) {
    // A prompt of a Player Dialogue action: said to the NPC it is filed under.
    if (playerKeys.has(node.speaker_key)) {
      return { kind: 'npc', speakerKey: dominantNpc(ownKeys, playerKeys) };
    }
    // ...and that NPC answering the prompt.
    if (playerExchanges.has(actionKey(turn.sceneId, turn.phaseOrder, turn.aliasId))) {
      return TO_PLAYER;
    }
  }

  const speaking = ownIsPlayer;
  const others = [...aliases.keys()].filter((id) => id !== turn.aliasId);
  const counterparts = others.filter((id) => !aliasIsPlayer(id, aliases.get(id) ?? [], playerKeys));

  // Companion idle / one-alias scene: the player is the implicit audience.
  if (!speaking && others.length === 0) return TO_PLAYER;

  // The player is in the scene and someone else is talking: they are the audience.
  if (!speaking && counterparts.length < others.length) return TO_PLAYER;

  if (counterparts.length === 1) {
    const counterpartKeys = aliases.get(counterparts[0]!) ?? [];
    if (speaking) return { kind: 'npc', speakerKey: dominantNpc(counterpartKeys, playerKeys) };

    // An alias the player is heard under more than its NPC is the player's
    // side of the conversation; the player is never an addressee by key.
    const heard = dominant(counterpartKeys);
    return heard != null && playerKeys.has(heard) ? TO_PLAYER : { kind: 'npc', speakerKey: heard };
  }
  return TO_UNKNOWN;
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
): Addressee => {
  if (!node.speaker_key || !playerKeys.has(node.speaker_key)) return TO_PLAYER;

  const counterpart = dominantNpc(topicSpeakers, playerKeys);
  return counterpart ? { kind: 'npc', speakerKey: counterpart } : TO_UNKNOWN;
};

/**
 * Resolve the addressee of every dialog node of one mod, and name the speakers
 * a scene alias can account for.
 *
 * @param nodes - Every dialog node, with the speaker key resolved at import.
 * @param phases - Scene phases linking scenes and aliases to dialog topics.
 * @param playerSpeakerKeys - Speaker keys of the player character, from player
 * voice types and actor records.
 */
export const resolveNodeAddressees = (
  nodes: SpeakerNodeRow[],
  phases: ScenePhaseRow[],
  playerSpeakerKeys: ReadonlySet<string> = new Set(),
): AddresseeResolution => {
  const nodesByTopic = new Map<number, SpeakerNodeRow[]>();
  for (const node of nodes) {
    const bucket = nodesByTopic.get(node.topic_id);
    if (bucket) bucket.push(node);
    else nodesByTopic.set(node.topic_id, [node]);
  }

  const sceneAliases = collectSceneAliases(nodesByTopic, phases);
  const nodeScenes = assignNodesToScenes(nodesByTopic, phases);
  const playerExchanges = collectPlayerExchanges(nodesByTopic, phases, playerSpeakerKeys);

  const recoveredSpeakers: RecoveredNodeSpeaker[] = [];
  const addressees = nodes.map<NodeAddressee>((node) => {
    const scene = nodeScenes.get(node.id);
    const aliases = scene ? sceneAliases.get(scene.sceneId) : undefined;

    if (scene && aliases) {
      if (!node.speaker_key) {
        const own = dominant(aliases.get(scene.aliasId) ?? []);
        if (own) recoveredSpeakers.push({ nodeId: node.id, speakerKey: own });
      }
      const resolved = addresseeForSceneTurn(
        aliases,
        scene,
        node,
        playerSpeakerKeys,
        playerExchanges,
      );
      return { nodeId: node.id, kind: resolved.kind, speakerKey: resolved.speakerKey };
    }

    const topicSpeakers = (nodesByTopic.get(node.topic_id) ?? [])
      .map((sibling) => sibling.speaker_key)
      .filter((key): key is string => key != null);
    const resolved = addresseeForTopicTurn(node, topicSpeakers, playerSpeakerKeys);
    return { nodeId: node.id, kind: resolved.kind, speakerKey: resolved.speakerKey };
  });

  return { addressees, recoveredSpeakers };
};
