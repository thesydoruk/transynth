/**
 * Gender of the NPC behind each `Sound/Voice/<Plugin>/<Folder>/` folder.
 *
 * Voice folders and dialog speakers are keyed differently: the voice subsystem
 * uses the bare folder name, the dialog graph uses `npc:<FormID>` or
 * `voice:<Folder>`. This module bridges the two so the voice UI can show whose
 * voice a folder is and flag the case where the folder name says one gender and
 * the plugin says the other — a reference clip picked from such a folder makes
 * the synthesized line sound like the wrong person.
 */
import type { Tx } from '../../../db';
import {
  effectiveSpeakerGenderSql,
  isDefiniteGender,
  parseSpeakerGender,
  resolveGenderFromVoiceTypeName,
  voiceFolderSpeakerKey,
  type SpeakerGender,
} from '../../../dialog';

/** What is known about the voice of one folder. */
export type VoiceFolderGender = {
  gender: SpeakerGender;
  /** Gender the folder name itself implies, e.g. `FemaleBoston` → female. */
  folderGender: SpeakerGender;
  /** True when the two disagree, so the folder's clips sound like the wrong gender. */
  mismatch: boolean;
};

type SpeakerGenderRow = {
  speaker_key: string;
  voice_type: string | null;
  effective_gender: string | null;
};

/**
 * Merge the genders claimed for one folder.
 *
 * Generic Bethesda folders are shared by dozens of NPCs, so a single dissenting
 * record is more likely to be a bad guess than a real exception; a conflict
 * therefore falls back to `unknown` instead of picking a side.
 */
const mergeGender = (current: SpeakerGender | undefined, next: SpeakerGender): SpeakerGender => {
  if (current === undefined || current === 'unknown') return next;
  if (next === 'unknown' || next === current) return current;
  return 'unknown';
};

/**
 * Resolve the speaker gender of every voice folder used by a mod.
 *
 * @returns Folder name → gender, keyed exactly as `voiceSpeakerKey` names it.
 */
export const loadVoiceFolderGenders = async (
  db: Tx,
  modId: number,
): Promise<Map<string, VoiceFolderGender>> => {
  const { rows } = await db.query<SpeakerGenderRow>(
    `SELECT sp.speaker_key, sp.voice_type, ${effectiveSpeakerGenderSql('sp')} AS effective_gender
     FROM dialog_speakers sp
     WHERE sp.mod_id = $1`,
    [modId],
  );

  const byFolder = new Map<string, SpeakerGender>();
  for (const row of rows) {
    const gender = parseSpeakerGender(row.effective_gender);
    const folders = new Set<string>();
    if (row.speaker_key.startsWith(voiceFolderSpeakerKey(''))) {
      folders.add(row.speaker_key.slice(voiceFolderSpeakerKey('').length));
    }
    if (row.voice_type) folders.add(row.voice_type);

    for (const folder of folders) {
      byFolder.set(folder, mergeGender(byFolder.get(folder), gender));
    }
  }

  const result = new Map<string, VoiceFolderGender>();
  for (const [folder, gender] of byFolder) {
    const folderGender = resolveGenderFromVoiceTypeName(folder);
    result.set(folder, {
      gender,
      folderGender,
      mismatch:
        isDefiniteGender(gender) && isDefiniteGender(folderGender) && gender !== folderGender,
    });
  }
  return result;
};
