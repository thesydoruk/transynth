/**
 * Disco Final Cut helpers for the voice editor preview API.
 */
import type { Tx } from '../../../db';
import { effectiveSpeakerGenderSql, parseSpeakerGender, type SpeakerGender } from '../../../dialog';
import {
  discoVoiceFormidLower6,
  discoVoiceSpeakerKey,
  discoverDiscoVoiceFiles,
  resolveDiscoVoiceExtractRoot,
} from '../../../voice/disco/discoverDiscoVoiceFiles';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import type { VoiceFolderGender } from './speakerGender';

export const discoverDiscoVoiceEntries = (pluginPath: string): VoiceFileEntry[] => {
  const extractRoot = resolveDiscoVoiceExtractRoot(pluginPath);
  if (!extractRoot) return [];
  return discoverDiscoVoiceFiles(extractRoot);
};

export { discoVoiceSpeakerKey };

/** Gender keyed by Disco speaker name (`Kim Kitsuragi`), from `dialog_speakers`. */
export const loadDiscoSpeakerGenders = async (
  db: Tx,
  modId: number,
): Promise<Map<string, VoiceFolderGender>> => {
  const { rows } = await db.query<{ speaker_key: string; effective_gender: string | null }>(
    `SELECT sp.speaker_key, ${effectiveSpeakerGenderSql('sp')} AS effective_gender
     FROM dialog_speakers sp
     WHERE sp.mod_id = $1`,
    [modId],
  );

  const result = new Map<string, VoiceFolderGender>();
  for (const row of rows) {
    const gender = parseSpeakerGender(row.effective_gender) as SpeakerGender;
    result.set(row.speaker_key, {
      gender,
      folderGender: 'unknown',
      mismatch: false,
    });
  }
  return result;
};

/** Display names from persisted Disco speakers. */
export const loadDiscoSpeakerNames = async (
  db: Tx,
  modId: number,
): Promise<Map<string, string>> => {
  const { rows } = await db.query<{ speaker_key: string; display_name: string | null }>(
    `SELECT speaker_key, display_name
     FROM dialog_speakers
     WHERE mod_id = $1
       AND display_name IS NOT NULL
       AND BTRIM(display_name) <> ''`,
    [modId],
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.speaker_key, row.display_name!.trim());
  }
  return map;
};

export { discoVoiceFormidLower6 };
