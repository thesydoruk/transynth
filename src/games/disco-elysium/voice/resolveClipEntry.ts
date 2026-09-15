/**
 * Resolve Disco wavs from `voice_clips` without scanning Audio/.
 */
import type { Tx } from '../../../db';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import {
  discoVoiceFileEntryFromClip,
  resolveDiscoPreferredLangFolder,
} from './discoverDiscoVoiceFiles';
import {
  loadDiscoVoiceClipByFormid,
  loadDiscoVoiceClipSummaries,
  type DiscoVoiceClipSummary,
} from './loadVoiceClips';
import { ensureDiscoVoiceClips } from './persistVoiceClips';

export type ResolvedDiscoClipEntry = {
  clip: DiscoVoiceClipSummary;
  entry: VoiceFileEntry;
};

const entriesFromClips = (
  extractRoot: string,
  clips: DiscoVoiceClipSummary[],
): VoiceFileEntry[] => {
  const langFolder = resolveDiscoPreferredLangFolder(extractRoot);
  if (!langFolder) return [];
  return clips.map((clip) => discoVoiceFileEntryFromClip(langFolder, clip));
};

export const resolveDiscoVoiceFilesFromClips = async (
  db: Tx,
  modId: number,
  extractRoot: string,
  speakerKey?: string,
): Promise<VoiceFileEntry[]> => {
  await ensureDiscoVoiceClips(db, modId, extractRoot);
  const clips = await loadDiscoVoiceClipSummaries(db, modId, speakerKey ? { speakerKey } : {});
  return entriesFromClips(extractRoot, clips);
};

export const resolveDiscoClipEntryByFormid = async (
  db: Tx,
  modId: number,
  extractRoot: string,
  lineKey: string,
): Promise<ResolvedDiscoClipEntry | null> => {
  await ensureDiscoVoiceClips(db, modId, extractRoot);
  const clip = await loadDiscoVoiceClipByFormid(db, modId, lineKey);
  if (!clip) return null;
  const [entry] = entriesFromClips(extractRoot, [clip]);
  if (!entry) return null;
  return { clip, entry };
};

export const resolveDiscoClipEntriesForSpeaker = (
  db: Tx,
  modId: number,
  extractRoot: string,
  speakerKey: string,
): Promise<VoiceFileEntry[]> => resolveDiscoVoiceFilesFromClips(db, modId, extractRoot, speakerKey);
