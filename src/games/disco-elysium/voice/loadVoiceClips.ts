/**
 * Read persisted Disco voice clips (no filesystem zip).
 */
import type { Tx } from '../../../db';

export type DiscoVoiceLoadFilter = {
  speakerKey?: string;
  lineKey?: string;
};

export type DiscoVoiceClipSummary = {
  wavStem: string;
  lineKey: string;
  speakerKey: string;
  recordId: number | null;
  relPath: string;
};

const clipFilters = (
  filter: DiscoVoiceLoadFilter,
): { speaker: string | null; formid: string | null } => ({
  speaker: filter.speakerKey?.trim() || null,
  formid: filter.lineKey?.trim().toUpperCase() || null,
});

export const loadDiscoVoiceClipSummaries = async (
  db: Tx,
  modId: number,
  filter: DiscoVoiceLoadFilter = {},
): Promise<DiscoVoiceClipSummary[]> => {
  const { speaker, formid } = clipFilters(filter);
  const { rows } = await db.query<{
    wav_stem: string;
    line_key: string;
    speaker_key: string;
    record_id: number | null;
    rel_path: string;
  }>(
    `SELECT clip_key AS wav_stem, line_key, speaker_key, record_id, rel_path
     FROM voice_clips
     WHERE mod_id = $1
       AND ($2::text IS NULL OR speaker_key = $2)
       AND ($3::text IS NULL OR UPPER(line_key) = $3)
     ORDER BY speaker_key, clip_key`,
    [modId, speaker, formid],
  );
  return rows.map((row) => ({
    wavStem: row.wav_stem,
    lineKey: row.line_key.toUpperCase(),
    speakerKey: row.speaker_key,
    recordId: row.record_id,
    relPath: row.rel_path,
  }));
};

export const loadDiscoVoiceClipByFormid = async (
  db: Tx,
  modId: number,
  lineKey: string,
): Promise<DiscoVoiceClipSummary | null> => {
  const rows = await loadDiscoVoiceClipSummaries(db, modId, { lineKey });
  return rows[0] ?? null;
};
