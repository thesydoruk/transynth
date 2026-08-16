/**
 * Disco wav-stem rows persisted in `disco_voice_clips`.
 */
import path from 'node:path';
import { voiceTranslationMapKey } from '../loadVoiceTranslations';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { discoVoiceFormidLower6, discoVoiceSpeakerKey } from './discoverDiscoVoiceFiles';
import type { DiscoVoiceTextRef } from './voiceTextIndex';

export type DiscoVoiceClipRow = {
  wavStem: string;
  formidLower12: string;
  speakerKey: string;
  recordId: number | null;
  msgctxtKey: string | null;
  articyId: string | null;
  field: string | null;
  relPath: string;
};

export type DiscoClipSpeakerCounts = {
  lineCount: number;
  dubbedCount: number;
  orphanCount: number;
};

const resolveRecordId = (
  stem: string,
  ref: DiscoVoiceTextRef | undefined,
  recordIdByMsgctxt: Map<string, number>,
): { recordId: number | null; msgctxtKey: string | null } => {
  if (ref) {
    const recordId =
      recordIdByMsgctxt.get(ref.msgctxtKey) ?? recordIdByMsgctxt.get(stem.toLowerCase()) ?? null;
    return { recordId, msgctxtKey: ref.msgctxtKey };
  }
  const recordId = recordIdByMsgctxt.get(stem.toLowerCase()) ?? null;
  return { recordId, msgctxtKey: null };
};

/** Join discovered wavs to lockit record ids via the wav↔msgctxt index. */
export const buildDiscoVoiceClipRows = (
  voiceFiles: VoiceFileEntry[],
  textIndex: Map<string, DiscoVoiceTextRef>,
  recordIdByMsgctxt: Map<string, number>,
): DiscoVoiceClipRow[] =>
  voiceFiles.map((entry) => {
    const wavStem = path.basename(entry.fileName, path.extname(entry.fileName));
    const ref = textIndex.get(wavStem);
    const { recordId, msgctxtKey } = resolveRecordId(wavStem, ref, recordIdByMsgctxt);
    return {
      wavStem,
      formidLower12: entry.formidLower6 || discoVoiceFormidLower6(wavStem),
      speakerKey: discoVoiceSpeakerKey(entry),
      recordId,
      msgctxtKey,
      articyId: ref?.articyId ?? null,
      field: ref?.field ?? null,
      relPath: entry.relPath,
    };
  });

/** Navigator counts from persisted clips + localized-audio keys. */
export const aggregateDiscoClipSpeakerCounts = (
  clips: ReadonlyArray<{ speakerKey: string; formidLower12: string; recordId: number | null }>,
  translationAudio: ReadonlySet<string>,
): Map<string, DiscoClipSpeakerCounts> => {
  const groups = new Map<string, DiscoClipSpeakerCounts>();
  for (const clip of clips) {
    let group = groups.get(clip.speakerKey);
    if (!group) {
      group = { lineCount: 0, dubbedCount: 0, orphanCount: 0 };
      groups.set(clip.speakerKey, group);
    }
    group.lineCount += 1;
    if (clip.recordId == null) group.orphanCount += 1;
    if (translationAudio.has(voiceTranslationMapKey(clip.formidLower12, 1))) {
      group.dubbedCount += 1;
    }
  }
  return groups;
};
