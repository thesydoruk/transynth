import type { Tx } from '../../../db';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  type VoiceFileEntry,
} from '../../../voice/discoverVoiceFiles';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import type { VoicePackageContext } from './context';

/** Clean a voice directory name into a human-readable speaker label. */
export const formatVoiceSpeakerLabel = (folderName: string): string => {
  let cleaned = folderName.replace(/Voice$/i, '');
  cleaned = cleaned.replace(/^NPC[FM]/i, '');
  if (cleaned.includes('_')) {
    cleaned = cleaned.substring(cleaned.lastIndexOf('_') + 1);
  }
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleaned = cleaned.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  const player = cleaned.trim().match(/^Player Voice (Female|Male)(?: \d+)?$/i);
  if (player) {
    const gender = player[1]!.toLowerCase();
    return `Player ${gender.charAt(0).toUpperCase()}${gender.slice(1)}`;
  }
  return cleaned.trim() || folderName;
};

export const loadSpeakerNamesFromDb = async (
  db: Tx,
  modId: number,
): Promise<Map<string, string>> => {
  const { rows } = await db.query<{ formid_lower6: string; speaker_name: string }>(
    `SELECT DISTINCT ON (UPPER(SUBSTRING(dn.info_formid_hex FROM 3)))
        UPPER(SUBSTRING(dn.info_formid_hex FROM 3)) AS formid_lower6,
        dn.speaker_name
     FROM dialog_nodes dn
     JOIN dialog_topics dt ON dt.id = dn.topic_id
     WHERE dt.mod_id = $1
       AND dn.speaker_name IS NOT NULL
       AND BTRIM(dn.speaker_name) <> ''
     ORDER BY UPPER(SUBSTRING(dn.info_formid_hex FROM 3)), dn.updated_at DESC`,
    [modId],
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.formid_lower6.toUpperCase(), row.speaker_name);
  }
  return map;
};

export const discoverVoiceEntries = (ctx: VoicePackageContext): VoiceFileEntry[] =>
  dedupeVoiceFiles(discoverVoiceFiles(ctx.packageDir, ctx.pluginRel));

/**
 * Resolve one voice file by FormID + response number.
 *
 * A FormID pair is ambiguous on its own: the same line exists once per voice
 * type, so pass `speakerKey` whenever the caller knows which speaker's take the
 * user asked for, or playback and dubbing can land on another actor's file.
 */
export const findVoiceEntry = (
  entries: VoiceFileEntry[],
  formidLower6: string,
  variant: number,
  scope?: { voiceRootRel: string; speakerKey?: string },
): VoiceFileEntry | undefined => {
  const wantSpeaker = scope?.speakerKey?.trim();
  return entries.find((entry) => {
    if (entry.formidLower6.toUpperCase() !== formidLower6.toUpperCase()) return false;
    if (entry.variant !== variant) return false;
    if (!wantSpeaker) return true;
    return voiceSpeakerKey(entry, scope!.voiceRootRel) === wantSpeaker;
  });
};
