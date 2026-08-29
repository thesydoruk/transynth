import type { VoiceFileEntry } from '../discoverVoiceFiles';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** NPC voice folder under `Sound/Voice/<plugin>/` (e.g. `AlexanderBrown`). */
export const voiceSpeakerKey = (entry: VoiceFileEntry, voiceRootRel: string): string => {
  const rel = normalizeRelPath(entry.relPath);
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
