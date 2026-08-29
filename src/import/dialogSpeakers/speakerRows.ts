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

/** Gender of an actor whose NPC_ record the plugin does not define. */
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
  const inferred = genderFromEvidence(evidence, index);
  const voiceType = actor?.voiceType ?? inferred.voiceType ?? folderName;

  return {
    speakerKey,
    displayName:
      actor?.name ?? fallbackName ?? (folderName ? cleanVoiceFolderName(folderName) : null),
    voiceType,
    isPlayer: actor?.isPlayer === true || (voiceType != null && isPlayerVoiceType(voiceType)),
    detectedGender: inferred.gender,
    detectedSource: inferred.source,
  };
};

/**
 * Build the speaker table of one mod.
 *
 * @param playerSpeakerKeys - Keys the scene graph proved to be the player, who
 * is always `any` because their gender is picked when the game starts.
 */
export const buildDialogSpeakerRows = (opts: {
  nodes: SpeakerSourceNode[];
  index: PluginSpeakerIndex;
  playerSpeakerKeys: Set<string>;
}): DialogSpeakerRow[] => {
  const evidence = collectEvidence(opts.nodes, opts.index);

  return [...evidence].map(([speakerKey, entry]) => {
    const row = buildRow(speakerKey, entry, opts.index);
    if (!opts.playerSpeakerKeys.has(speakerKey) && speakerKey !== PLAYER_SPEAKER_KEY) return row;
    return { ...row, isPlayer: true, detectedGender: 'any', detectedSource: 'player' };
  });
};
