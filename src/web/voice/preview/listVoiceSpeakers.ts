import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { getVoiceListContext } from './voiceListContext';
import {
  isOrphanVoiceEntry,
  resolveSpeakerDisplayName,
  resolveSpeakerKey,
  sortSpeakers,
} from './buildVoiceLinePreview';
import { hasTranslationAudio } from './translationAudioIndex';
import type { VoiceSpeakersListResult } from './types';

/** List voice speakers with dubbing progress, without loading every line's text. */
export const listVoiceSpeakersForMod = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceSpeakersListResult> => {
  const loaded = await getVoiceListContext(db, modId, srcLang, targetLang);
  if (!loaded.ok) return loaded;

  const {
    voiceFiles,
    voiceRootRel,
    isDisco,
    dbSpeakerNames,
    speakerRefs,
    folderGenders,
    translationAudio,
    sourceFormids,
  } = loaded.data;
  const groups = new Map<
    string,
    {
      displayName: string;
      lineCount: number;
      dubbedCount: number;
      orphanCount: number;
    }
  >();

  for (const entry of voiceFiles) {
    const speakerKey = resolveSpeakerKey(entry, voiceRootRel, isDisco);
    let group = groups.get(speakerKey);
    if (!group) {
      group = {
        displayName: resolveSpeakerDisplayName(
          speakerKey,
          entry.formidLower6,
          dbSpeakerNames,
          isDisco,
        ),
        lineCount: 0,
        dubbedCount: 0,
        orphanCount: 0,
      };
      groups.set(speakerKey, group);
    }
    group.lineCount += 1;
    if (isOrphanVoiceEntry(sourceFormids, entry)) group.orphanCount += 1;
    if (hasTranslationAudio(translationAudio, entry.formidLower6, entry.variant)) {
      group.dubbedCount += 1;
    }
  }

  const speakers = sortSpeakers(
    [...groups.entries()].map(([key, group]) => {
      const folderGender = folderGenders.get(key);
      return {
        key,
        displayName: group.displayName,
        referencePick: speakerRefs[key] ?? null,
        gender: folderGender?.gender ?? 'unknown',
        genderMismatch: folderGender?.mismatch ?? false,
        lineCount: group.lineCount,
        dubbedCount: group.dubbedCount,
        orphanCount: group.orphanCount,
      };
    }),
  );

  const totalLines = speakers.reduce((sum, speaker) => sum + speaker.lineCount, 0);
  log.debug(`Voice speakers mod=${modId}: ${totalLines} lines in ${speakers.length} groups`);
  return { ok: true, speakers, totalLines };
};
