/**
 * Persist Disco Final Cut speakers derived from Audio/ wav stems.
 */
import type { Tx } from '../../../db';
import { discoSpeakerKeyFromStem } from '../voice/discoverDiscoVoiceFiles';
import type { DialogSpeakerRow } from '../../../import/dialogSpeakers/speakerRows';

const isPlayerSpeakerKey = (key: string): boolean => /^you$/i.test(key) || /^harry\b/i.test(key);

/**
 * Harrier Du Bois is written male, not created by the player.
 *
 * Stored as a detected gender rather than left to the `is_player` fallback,
 * which resolves to `any` — right for a Bethesda protagonist and wrong here:
 * hedging every line Harry speaks would flatten the character.
 */
const PLAYER_GENDER = 'male';

/** Aggregate unique speakers and line counts from wav stems. */
export const buildDiscoSpeakerRowsFromStems = (
  wavStems: Iterable<string>,
): { speakers: DialogSpeakerRow[]; lineCounts: Map<string, number> } => {
  const lineCounts = new Map<string, number>();
  for (const stem of wavStems) {
    const key = discoSpeakerKeyFromStem(stem);
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
  }

  const speakers: DialogSpeakerRow[] = [...lineCounts.keys()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((speakerKey) => ({
      speakerKey,
      displayName: speakerKey === 'Unknown' ? null : speakerKey,
      voiceType: null,
      isPlayer: isPlayerSpeakerKey(speakerKey),
      detectedGender: isPlayerSpeakerKey(speakerKey) ? PLAYER_GENDER : 'unknown',
      detectedSource: isPlayerSpeakerKey(speakerKey) ? 'player' : null,
    }));

  return { speakers, lineCounts };
};

/** Upsert Disco speakers; remove keys that disappeared from Audio/. */
export const persistDiscoSpeakers = async (
  db: Tx,
  modId: number,
  wavStems: Iterable<string>,
): Promise<number> => {
  const stems = [...wavStems];
  const { speakers, lineCounts } = buildDiscoSpeakerRowsFromStems(stems);
  if (speakers.length === 0) {
    await db.query(`DELETE FROM dialog_speakers WHERE mod_id = $1`, [modId]);
    return 0;
  }

  await db.query(
    `UPDATE voice_clips vc
        SET speaker_key = v.new_key
       FROM UNNEST($2::text[], $3::text[]) AS v(clip_key, new_key)
      WHERE vc.mod_id = $1
        AND vc.clip_key = v.clip_key
        AND vc.speaker_key IS DISTINCT FROM v.new_key`,
    [modId, stems, stems.map((stem) => discoSpeakerKeyFromStem(stem))],
  );

  await db.query(
    `INSERT INTO dialog_speakers(
       mod_id, speaker_key, display_name, voice_type, is_player,
       detected_gender, detected_source, line_count
     )
     SELECT $1, * FROM UNNEST(
       $2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[], $7::text[], $8::int[]
     )
     ON CONFLICT(mod_id, speaker_key) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, dialog_speakers.display_name),
       voice_type = COALESCE(EXCLUDED.voice_type, dialog_speakers.voice_type),
       is_player = EXCLUDED.is_player,
       detected_gender = EXCLUDED.detected_gender,
       detected_source = EXCLUDED.detected_source,
       line_count = EXCLUDED.line_count,
       updated_at = NOW()`,
    [
      modId,
      speakers.map((s) => s.speakerKey),
      speakers.map((s) => s.displayName),
      speakers.map((s) => s.voiceType),
      speakers.map((s) => s.isPlayer),
      speakers.map((s) => s.detectedGender),
      speakers.map((s) => s.detectedSource),
      speakers.map((s) => lineCounts.get(s.speakerKey) ?? 0),
    ],
  );

  await db.query(
    `DELETE FROM dialog_speakers WHERE mod_id = $1 AND speaker_key <> ALL($2::text[])`,
    [modId, speakers.map((s) => s.speakerKey)],
  );

  return speakers.length;
};
