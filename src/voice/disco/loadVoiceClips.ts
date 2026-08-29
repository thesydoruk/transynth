/**
 * Read persisted Disco voice clips (no filesystem zip).
 */
import type { Tx } from '../../db';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';
import type { DiscoVoiceClipRow } from './voiceClipRows';

export type DiscoVoiceLoadFilter = {
  speakerKey?: string;
  formidLower12?: string;
};

export type DiscoVoiceClipSummary = {
  wavStem: string;
  formidLower12: string;
  speakerKey: string;
  recordId: number | null;
  relPath: string;
};

const clipFilters = (
  filter: DiscoVoiceLoadFilter,
): { speaker: string | null; formid: string | null } => ({
  speaker: filter.speakerKey?.trim() || null,
  formid: filter.formidLower12?.trim().toUpperCase() || null,
});

export const loadDiscoVoiceClipSummaries = async (
  db: Tx,
  modId: number,
  filter: DiscoVoiceLoadFilter = {},
): Promise<DiscoVoiceClipSummary[]> => {
  const { speaker, formid } = clipFilters(filter);
  const { rows } = await db.query<{
    wav_stem: string;
    formid_lower12: string;
    speaker_key: string;
    record_id: number | null;
    rel_path: string;
  }>(
    `SELECT wav_stem, formid_lower12, speaker_key, record_id, rel_path
     FROM disco_voice_clips
     WHERE mod_id = $1
       AND ($2::text IS NULL OR speaker_key = $2)
       AND ($3::text IS NULL OR UPPER(formid_lower12) = $3)
     ORDER BY speaker_key, wav_stem`,
    [modId, speaker, formid],
  );
  return rows.map((row) => ({
    wavStem: row.wav_stem,
    formidLower12: row.formid_lower12.toUpperCase(),
    speakerKey: row.speaker_key,
    recordId: row.record_id,
    relPath: row.rel_path,
  }));
};

export const loadDiscoVoiceClipByFormid = async (
  db: Tx,
  modId: number,
  formidLower12: string,
): Promise<DiscoVoiceClipSummary | null> => {
  const rows = await loadDiscoVoiceClipSummaries(db, modId, { formidLower12 });
  return rows[0] ?? null;
};

export const loadDiscoVoiceClipRows = async (
  db: Tx,
  modId: number,
  filter: DiscoVoiceLoadFilter = {},
): Promise<DiscoVoiceClipRow[]> => {
  const { speaker, formid } = clipFilters(filter);
  const { rows } = await db.query<{
    wav_stem: string;
    formid_lower12: string;
    speaker_key: string;
    record_id: number | null;
    msgctxt_key: string | null;
    articy_id: string | null;
    field: string | null;
    rel_path: string;
  }>(
    `SELECT wav_stem, formid_lower12, speaker_key, record_id,
            msgctxt_key, articy_id, field, rel_path
     FROM disco_voice_clips
     WHERE mod_id = $1
       AND ($2::text IS NULL OR speaker_key = $2)
       AND ($3::text IS NULL OR UPPER(formid_lower12) = $3)
     ORDER BY wav_stem`,
    [modId, speaker, formid],
  );
  return rows.map((row) => ({
    wavStem: row.wav_stem,
    formidLower12: row.formid_lower12.toUpperCase(),
    speakerKey: row.speaker_key,
    recordId: row.record_id,
    msgctxtKey: row.msgctxt_key,
    articyId: row.articy_id,
    field: row.field,
    relPath: row.rel_path,
  }));
};

export const discoFormidFromStem = (stem: string): string => discoVoiceFormidLower6(stem);
