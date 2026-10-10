/**
 * Speaker names and genders for the voice tab, from `dialog_speakers`.
 *
 * For a game whose voice clips are keyed by a speaker the import named —
 * Disco Elysium's wav-stem actor, The Witcher 3's scene voice tag — rather
 * than by a voice-type folder, both lookups are keyed by `speaker_key`.
 */
import type { Tx } from '../db';
import { effectiveSpeakerGenderSql, parseSpeakerGender, type SpeakerGender } from '../dialog';
import type { VoiceFolderGender } from '../web/voice/preview/speakerGender';

/** Gender keyed by speaker key; there is no folder whose name could disagree. */
export const loadDialogSpeakerGenders = async (
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
      folderGender: 'unknown',
      mismatch: false,
    });
  }
  return result;
};

/** Display names of a mod's speakers, keyed by speaker key. */
export const loadDialogSpeakerNames = async (
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
