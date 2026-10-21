import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { speakerFromVoiceRelPath } from '../voiceOrigin';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/**
 * NPC voice folder of a take (e.g. `AlexanderBrown`).
 *
 * Inside a `Sound/Voice/<origin>/` tree it is the folder below the origin,
 * whichever origin that is — a patch's take under `Sound/Voice/Fallout4.esm/`
 * has a speaker just like one under the patch's own folder. `voiceRootRel`
 * only matters for trees that are not laid out that way.
 */
export const voiceSpeakerKey = (entry: VoiceFileEntry, voiceRootRel: string): string => {
  const rel = normalizeRelPath(entry.relPath);
  const fromTree = speakerFromVoiceRelPath(rel);
  if (fromTree != null) return fromTree;
  const prefix = `${normalizeRelPath(voiceRootRel)}/`;
  if (!rel.startsWith(prefix)) return '';
  const rest = rel.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash >= 0 ? rest.slice(0, slash) : '';
};

/** Group voice files by NPC folder name under the plugin voice root. */
export const groupVoiceFilesBySpeaker = (
  entries: VoiceFileEntry[],
  voiceRootRel: string,
): Map<string, VoiceFileEntry[]> => {
  const bySpeaker = new Map<string, VoiceFileEntry[]>();
  for (const entry of entries) {
    const speaker = voiceSpeakerKey(entry, voiceRootRel);
    if (!speaker) continue;
    const list = bySpeaker.get(speaker) ?? [];
    list.push(entry);
    bySpeaker.set(speaker, list);
  }
  return bySpeaker;
};
