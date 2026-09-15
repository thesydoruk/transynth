/**
 * Speaker metadata for Disco Elysium packs.
 *
 * A Disco speaker is a name (`Kim Kitsuragi`) recorded at import from the wav
 * stems, not a voice-type folder, so both lookups are keyed by that name.
 */
import type { Tx } from '../../../db';
import { effectiveSpeakerGenderSql, parseSpeakerGender, type SpeakerGender } from '../../../dialog';
import type { VoiceFolderGender } from '../../../web/voice/preview/speakerGender';

/** Gender keyed by Disco speaker name, from `dialog_speakers`. */
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
    result.set(row.speaker_key, {
      gender: parseSpeakerGender(row.effective_gender) as SpeakerGender,
      // Disco has no per-folder gender that could disagree with the record.
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
  return new Map(rows.map((row) => [row.speaker_key, row.display_name!.trim()]));
};
