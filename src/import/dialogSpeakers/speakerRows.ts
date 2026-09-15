/**
 * Turn dialog nodes plus plugin facts into one row per distinct speaker.
 */
import {
  PLAYER_SPEAKER_KEY,
  isPlayerVoiceType,
  type GenderSource,
  type SpeakerGender,
} from '../../dialog';
import { cleanVoiceFolderName } from '../mod/speakerMaps';
import { genderFromVoiceTypeIndex, type PluginSpeakerIndex } from './pluginSpeakerIndex';

export type SpeakerSourceNode = {
  speaker_key: string | null;
  speaker_name: string | null;
  info_formid_hex: string;
};

export type DialogSpeakerRow = {
  speakerKey: string;
  displayName: string | null;
  voiceType: string | null;
  isPlayer: boolean;
  detectedGender: SpeakerGender;
  detectedSource: GenderSource | null;
};

type SpeakerEvidence = {
  names: Set<string>;
  voiceFolders: Set<string>;
};

const collectEvidence = (
  nodes: SpeakerSourceNode[],
  index: PluginSpeakerIndex,
): Map<string, SpeakerEvidence> => {
  const evidence = new Map<string, SpeakerEvidence>();

  for (const node of nodes) {
    if (!node.speaker_key) continue;
    let entry = evidence.get(node.speaker_key);
    if (!entry) {
      entry = { names: new Set(), voiceFolders: new Set() };
      evidence.set(node.speaker_key, entry);
    }
    if (node.speaker_name) entry.names.add(node.speaker_name);
    const folder = index.voiceFolders.get(node.info_formid_hex.substring(2));
    if (folder) entry.voiceFolders.add(folder);
  }

  return evidence;
};

/**
 * Gender of an actor whose NPC_ record the plugin does not define.
 *
 * Only the plugin's own evidence is used here. A mod voice type named after
 * the character (`SS2_VT_Lydia`) says nothing a naming convention can read, and
 * that gap is closed afterwards from the mod's text — see `pronounEvidence`.
 */
const genderFromEvidence = (
  evidence: SpeakerEvidence,
  index: PluginSpeakerIndex,
): { gender: SpeakerGender; source: GenderSource | null; voiceType: string | null } => {
  for (const folder of evidence.voiceFolders) {
    const resolved = genderFromVoiceTypeIndex(index, folder);
    if (resolved.gender !== 'unknown') {
      return { gender: resolved.gender, source: resolved.source, voiceType: folder };
    }
  }
  return { gender: 'unknown', source: null, voiceType: [...evidence.voiceFolders][0] ?? null };
};

const buildRow = (
  speakerKey: string,
  evidence: SpeakerEvidence,
  index: PluginSpeakerIndex,
): DialogSpeakerRow => {
  const fallbackName = [...evidence.names][0] ?? null;
  const actor = speakerKey.startsWith('npc:')
    ? index.actors.get(speakerKey.slice('npc:'.length))
    : undefined;

  if (actor && actor.gender !== 'unknown') {
    return {
      speakerKey,
      displayName: actor.name ?? fallbackName,
      voiceType: actor.voiceType ?? [...evidence.voiceFolders][0] ?? null,
      isPlayer: actor.isPlayer,
      detectedGender: actor.gender,
      detectedSource: actor.source,
    };
  }

  const folderName = speakerKey.startsWith('voice:') ? speakerKey.slice('voice:'.length) : null;
  const displayName =
    actor?.name ?? fallbackName ?? (folderName ? cleanVoiceFolderName(folderName) : null);
  const inferred = genderFromEvidence(evidence, index);
  const voiceType = actor?.voiceType ?? inferred.voiceType ?? folderName;

  return {
    speakerKey,
    displayName,
    voiceType,
    isPlayer: actor?.isPlayer === true || (voiceType != null && isPlayerVoiceType(voiceType)),
    detectedGender: inferred.gender,
    detectedSource: inferred.source,
  };
};

/**
 * Build the speaker table of one mod from the plugin alone.
 *
 * Scene aliases can prove that a speaker is the player, but that evidence is
 * only available once addressees are resolved, and addressee resolution needs
 * to know who the player is. The knot is cut by running this first — voice
 * types and actor records already identify most player speakers — and applying
 * the alias evidence afterwards with {@link markPlayerSpeakers}.
 */
export const buildDialogSpeakerRows = (opts: {
  nodes: SpeakerSourceNode[];
  index: PluginSpeakerIndex;
}): DialogSpeakerRow[] => {
  const evidence = collectEvidence(opts.nodes, opts.index);
  return [...evidence].map(([speakerKey, entry]) => buildRow(speakerKey, entry, opts.index));
};

/**
 * Force the player's own rows to `any`, whose gender is picked when the game
 * starts and can never be committed to in a translation.
 */
export const markPlayerSpeakers = (
  rows: DialogSpeakerRow[],
  playerSpeakerKeys: ReadonlySet<string>,
): DialogSpeakerRow[] =>
  rows.map((row) => {
    const isPlayer =
      row.isPlayer ||
      playerSpeakerKeys.has(row.speakerKey) ||
      row.speakerKey === PLAYER_SPEAKER_KEY;
    if (!isPlayer) return row;
    return { ...row, isPlayer: true, detectedGender: 'any', detectedSource: 'player' };
  });

/** Speaker keys these rows already identify as the player character. */
export const playerKeysFromRows = (rows: readonly DialogSpeakerRow[]): Set<string> =>
  new Set(rows.filter((row) => row.isPlayer).map((row) => row.speakerKey));
