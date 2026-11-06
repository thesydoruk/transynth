/** Rows of `video_assets`: registration by the agent, listing for the page. */
import fs from 'node:fs';
import type { Tx } from '../db';
import type { GameId } from '../types';
import type { VideoPackTask } from '../vortex/types';
import { resolveVideoAudioPath } from './audioStore';
import type { VideoAssetRegistration, VideoAssetRow, VideoAssetStatus } from './types';

const videoAudioByteSize = (relPath: string): number | null => {
  try {
    return fs.statSync(resolveVideoAudioPath(relPath)).size;
  } catch {
    return null;
  }
};

const COLUMNS = `id, game, agent_key, file_name, byte_size, fingerprint, duration_s, track_ids,
  source_track_id, audio_rel_path, status, mod_id, dub_rel_path, dub_version, packed_version,
  error, created_at, updated_at`;

const fromRow = (row: Record<string, unknown>): VideoAssetRow =>
  ({
    ...row,
    byte_size: Number(row.byte_size),
    track_ids: Array.isArray(row.track_ids) ? (row.track_ids as number[]) : [],
  }) as VideoAssetRow;

/**
 * Register a video the agent found. A changed fingerprint means Vortex swapped
 * the file: the old audio, separation and dub no longer describe it, so the row
 * goes back to `registered` and the agent uploads the track again.
 */
export const registerVideoAsset = async (
  db: Tx,
  game: GameId,
  reg: VideoAssetRegistration,
): Promise<VideoAssetRow> => {
  const { rows } = await db.query(
    `INSERT INTO video_assets
       (game, agent_key, file_name, byte_size, fingerprint, duration_s, track_ids, source_track_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (game, file_name) DO UPDATE SET
       agent_key = EXCLUDED.agent_key,
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
      game,
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

export const listVideoAssets = async (db: Tx, game: GameId): Promise<VideoAssetRow[]> => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM video_assets WHERE game = $1 ORDER BY file_name`,
    [game],
  );
  return rows.map(fromRow);
};

export const getVideoAsset = async (db: Tx, id: number): Promise<VideoAssetRow | null> => {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM video_assets WHERE id = $1`, [id]);
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

/** The videos of a game whose finished dub is not in the file yet, for the agent's heartbeat. */
export const listVideoPackTasks = async (db: Tx, game: GameId): Promise<VideoPackTask[]> => {
  const { rows } = await db.query<{
    id: number;
    file_name: string;
    dub_version: string;
    dub_rel_path: string;
  }>(
    `SELECT id, file_name, dub_version, dub_rel_path FROM video_assets
     WHERE game = $1 AND dub_rel_path IS NOT NULL AND dub_version IS NOT NULL
       AND status IN ('dubbed', 'packed')
       AND packed_version IS DISTINCT FROM dub_version
     ORDER BY file_name`,
    [game],
  );
  return rows.map((row) => ({
    videoId: row.id,
    fileName: row.file_name,
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
