/**
 * Persist Disco wav↔lockit joins into `disco_voice_clips` at import time.
 */
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { discoSpokenSignatureSqlValues } from '../../import/mod/discoPoSignature';
import {
  discoverDiscoVoiceFiles,
  resolveDiscoPreferredLangFolder,
} from './discoverDiscoVoiceFiles';
import { discoVoiceMsgctxtKeyFromPath } from './remapVoiceRows';
import { getDiscoVoiceTextIndex } from './voiceTextIndex';
import { buildDiscoVoiceClipRows, type DiscoVoiceClipRow } from './voiceClipRows';

const insertClipChunk = async (
  db: Tx,
  modId: number,
  slice: DiscoVoiceClipRow[],
): Promise<void> => {
  await db.query(
    `INSERT INTO disco_voice_clips(
       mod_id, wav_stem, formid_lower12, speaker_key, record_id,
       msgctxt_key, articy_id, field, rel_path
     )
     SELECT $1, * FROM UNNEST(
       $2::text[], $3::text[], $4::text[], $5::int[],
       $6::text[], $7::text[], $8::text[], $9::text[]
     )`,
    [
      modId,
      slice.map((row) => row.wavStem),
      slice.map((row) => row.formidLower12),
      slice.map((row) => row.speakerKey),
      slice.map((row) => row.recordId),
      slice.map((row) => row.msgctxtKey),
      slice.map((row) => row.articyId),
      slice.map((row) => row.field),
      slice.map((row) => row.relPath),
    ],
  );
};

/** Map spoken PO msgctxt keys (and raw wav-stem EDIDs) to `records.id`. */
export const loadDiscoSpokenRecordIdsByMsgctxt = async (
  db: Tx,
  modId: number,
): Promise<Map<string, number>> => {
  const { rows } = await db.query<{ id: number; path: string; edid: string | null }>(
    `SELECT id, path, edid
     FROM records
     WHERE mod_id = $1
       AND signature = ANY($2::text[])`,
    [modId, discoSpokenSignatureSqlValues()],
  );

  const map = new Map<string, number>();
  for (const row of rows) {
    const msgctxtKey = discoVoiceMsgctxtKeyFromPath(row.path, row.edid);
    if (msgctxtKey && !map.has(msgctxtKey)) map.set(msgctxtKey, row.id);
  }
  return map;
};

export const countDiscoVoiceClips = async (db: Tx, modId: number): Promise<number> => {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM disco_voice_clips WHERE mod_id = $1`,
    [modId],
  );
  return Number(rows[0]?.n ?? 0);
};

/** Replace clip rows for a mod from the extract pack + spoken records. */
export const persistDiscoVoiceClips = async (
  db: Tx,
  modId: number,
  extractRoot: string,
): Promise<number> => {
  if (!resolveDiscoPreferredLangFolder(extractRoot)) {
    await db.query(`DELETE FROM disco_voice_clips WHERE mod_id = $1`, [modId]);
    return 0;
  }

  const voiceFiles = discoverDiscoVoiceFiles(extractRoot);
  if (voiceFiles.length === 0) {
    await db.query(`DELETE FROM disco_voice_clips WHERE mod_id = $1`, [modId]);
    return 0;
  }

  const rows = buildDiscoVoiceClipRows(
    voiceFiles,
    getDiscoVoiceTextIndex(extractRoot),
    await loadDiscoSpokenRecordIdsByMsgctxt(db, modId),
  );

  await db.query(`DELETE FROM disco_voice_clips WHERE mod_id = $1`, [modId]);
  const chunkSize = Math.max(1, CONFIG.dbChunkSize);
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insertClipChunk(db, modId, rows.slice(i, i + chunkSize));
  }
  return rows.length;
};

/** Build clip rows when this mod has none yet (existing imports / first page open). */
export const ensureDiscoVoiceClips = async (
  db: Tx,
  modId: number,
  extractRoot: string | null | undefined,
): Promise<number> => {
  const existing = await countDiscoVoiceClips(db, modId);
  if (existing > 0) return existing;
  if (!extractRoot) return 0;
  return persistDiscoVoiceClips(db, modId, extractRoot);
};
