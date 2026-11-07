/** Rows of `video_assets`: registration by the import, listing for the editor and the agent. */
import fs from 'node:fs';
import type { Tx } from '../db';
import type { VideoPackTask, VideoUploadTask } from '../vortex/types';
import { resolveVideoAudioPath } from './audioStore';
import type { VideoAssetRegistration, VideoAssetRow, VideoAssetStatus } from './types';

const videoAudioByteSize = (relPath: string): number | null => {
  try {
    return fs.statSync(resolveVideoAudioPath(relPath)).size;
  } catch {
    return null;
  }
};

const COLUMNS = `id, mod_id, agent_key, file_name, byte_size, fingerprint, duration_s, track_ids,
  source_track_id, audio_rel_path, status, dub_rel_path, dub_version, packed_version,
  error, created_at, updated_at`;

const V_COLUMNS = COLUMNS.split(',')
  .map((column) => `v.${column.trim()}`)
  .join(', ');

const fromRow = (row: Record<string, unknown>): VideoAssetRow =>
  ({
    ...row,
    byte_size: Number(row.byte_size),
    track_ids: Array.isArray(row.track_ids) ? (row.track_ids as number[]) : [],
  }) as VideoAssetRow;

/**
 * Register a video of a mod from the agent's manifest. A changed fingerprint
 * means the file was swapped: the old audio, separation and dub no longer
 * describe it, so the row goes back to `registered` and the agent uploads
 * the track again.
 */
export const registerVideoAsset = async (
  db: Tx,
  modId: number,
  reg: VideoAssetRegistration,
): Promise<VideoAssetRow> => {
  const { rows } = await db.query(
    `INSERT INTO video_assets
       (mod_id, agent_key, file_name, byte_size, fingerprint, duration_s, track_ids, source_track_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (mod_id, file_name) DO UPDATE SET
       agent_key = COALESCE(EXCLUDED.agent_key, video_assets.agent_key),
       byte_size = EXCLUDED.byte_size,
       duration_s = EXCLUDED.duration_s,
       track_ids = EXCLUDED.track_ids,
       source_track_id = EXCLUDED.source_track_id,
       fingerprint = EXCLUDED.fingerprint,
       audio_rel_path = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                             THEN video_assets.audio_rel_path ELSE NULL END,
       dub_rel_path = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                           THEN video_assets.dub_rel_path ELSE NULL END,
       dub_version = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                          THEN video_assets.dub_version ELSE NULL END,
       packed_version = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                             THEN video_assets.packed_version ELSE NULL END,
       status = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                     THEN video_assets.status ELSE 'registered' END,
       error = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                    THEN video_assets.error ELSE NULL END,
       updated_at = NOW()
     RETURNING ${COLUMNS}`,
    [
      modId,
      reg.agentKey,
      reg.fileName,
      reg.byteSize,
      reg.fingerprint,
      reg.durationS,
      JSON.stringify(reg.trackIds),
      reg.sourceTrackId,
    ],
  );
  return fromRow(rows[0]!);
};

export const listVideoAssets = async (db: Tx, modId: number): Promise<VideoAssetRow[]> => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM video_assets WHERE mod_id = $1 ORDER BY file_name`,
    [modId],
  );
  return rows.map(fromRow);
};

export const getVideoAsset = async (db: Tx, id: number): Promise<VideoAssetRow | null> => {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM video_assets WHERE id = $1`, [id]);
  return rows[0] ? fromRow(rows[0]) : null;
};

/** One video of one mod, or null when the id is not that mod's. */
export const getVideoAssetOfMod = async (
  db: Tx,
  modId: number,
  id: number,
): Promise<VideoAssetRow | null> => {
  const asset = await getVideoAsset(db, id);
  return asset && asset.mod_id === modId ? asset : null;
};

/**
 * The newest asset of the same file (by hash) in another mod of the same game
 * that already holds audio: what a new mod version carries its separation and
 * dub over from.
 */
export const findVideoCarrySource = async (
  db: Tx,
  opts: { fingerprint: string; game: string; excludeModId: number },
): Promise<VideoAssetRow | null> => {
  const { rows } = await db.query(
    `SELECT ${V_COLUMNS}
       FROM video_assets v JOIN mods m ON m.id = v.mod_id
      WHERE v.fingerprint = $1 AND m.game = $2 AND v.mod_id <> $3 AND v.audio_rel_path IS NOT NULL
      ORDER BY v.updated_at DESC, v.id DESC
      LIMIT 1`,
    [opts.fingerprint, opts.game, opts.excludeModId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
};

/** The upload landed: remember where, and move the row on from `registered`. */
export const setVideoAssetAudio = async (
  db: Tx,
  id: number,
  audioRelPath: string,
): Promise<void> => {
  await db.query(
    `UPDATE video_assets
        SET audio_rel_path = $2, status = 'uploaded', error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id, audioRelPath],
  );
};

/** Current mods of a Vortex group: the agent's own, and only their newest version. */
const GROUP_MODS = `SELECT id FROM mods WHERE vortex_group_id = $1 AND COALESCE(is_current, TRUE)`;

/** The videos of a group's mods whose audio the agent has not uploaded yet. */
export const listVideoUploadTasks = async (db: Tx, groupId: number): Promise<VideoUploadTask[]> => {
  const { rows } = await db.query<{
    id: number;
    mod_id: number;
    file_name: string;
    fingerprint: string;
    source_track_id: number | null;
  }>(
    `SELECT id, mod_id, file_name, fingerprint, source_track_id FROM video_assets
      WHERE mod_id IN (${GROUP_MODS}) AND audio_rel_path IS NULL AND status = 'registered'
      ORDER BY mod_id, file_name`,
    [groupId],
  );
  return rows.map((row) => ({
    videoId: row.id,
    modId: row.mod_id,
    fileName: row.file_name,
    fingerprint: row.fingerprint,
    sourceTrackId: row.source_track_id,
  }));
};

/** The videos of a group's mods whose finished dub is not in the file yet. */
export const listVideoPackTasks = async (db: Tx, groupId: number): Promise<VideoPackTask[]> => {
  const { rows } = await db.query<{
    id: number;
    mod_id: number;
    file_name: string;
    fingerprint: string;
    dub_version: string;
    dub_rel_path: string;
  }>(
    `SELECT id, mod_id, file_name, fingerprint, dub_version, dub_rel_path FROM video_assets
      WHERE mod_id IN (${GROUP_MODS})
        AND dub_rel_path IS NOT NULL AND dub_version IS NOT NULL
        AND status IN ('dubbed', 'packed')
        AND packed_version IS DISTINCT FROM dub_version
      ORDER BY mod_id, file_name`,
    [groupId],
  );
  return rows.map((row) => ({
    videoId: row.id,
    modId: row.mod_id,
    fileName: row.file_name,
    fingerprint: row.fingerprint,
    dubVersion: row.dub_version,
    byteSize: videoAudioByteSize(row.dub_rel_path),
  }));
};

/** The agent wrote this dub version into the video. */
export const setVideoAssetPacked = async (
  db: Tx,
  id: number,
  dubVersion: string,
): Promise<boolean> => {
  const { rowCount } = await db.query(
    `UPDATE video_assets
        SET packed_version = $2,
            status = CASE WHEN dub_version = $2 THEN 'packed' ELSE status END,
            updated_at = NOW()
      WHERE id = $1`,
    [id, dubVersion],
  );
  return (rowCount ?? 0) > 0;
};

export const setVideoAssetStatus = async (
  db: Tx,
  id: number,
  status: VideoAssetStatus,
  error: string | null = null,
): Promise<void> => {
  await db.query(
    `UPDATE video_assets SET status = $2, error = $3, updated_at = NOW() WHERE id = $1`,
    [id, status, error],
  );
};
