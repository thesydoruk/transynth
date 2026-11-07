/** Rows of `video_assets`: registration by the import, listing for the editor and the agent. */
import type { Tx } from '../db';
import { sha1Hex } from '../utils/hash';
import type { VideoUploadTask, VortexLatestVideopack } from '../vortex/types';
import { videoFile, videoPackedFile } from './audioStore';
import type {
  VideoAssetProbe,
  VideoAssetRegistration,
  VideoAssetRow,
  VideoAssetStatus,
} from './types';

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
 * means the file was swapped: the old tracks, audio, separation and dub no
 * longer describe it, so the row goes back to `registered` and the agent
 * uploads the file again.
 */
export const registerVideoAsset = async (
  db: Tx,
  modId: number,
  reg: VideoAssetRegistration,
): Promise<VideoAssetRow> => {
  const { rows } = await db.query(
    `INSERT INTO video_assets (mod_id, agent_key, file_name, byte_size, fingerprint)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (mod_id, file_name) DO UPDATE SET
       agent_key = COALESCE(EXCLUDED.agent_key, video_assets.agent_key),
       byte_size = EXCLUDED.byte_size,
       fingerprint = EXCLUDED.fingerprint,
       duration_s = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                         THEN video_assets.duration_s ELSE NULL END,
       track_ids = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                        THEN video_assets.track_ids ELSE '[]'::jsonb END,
       source_track_id = CASE WHEN video_assets.fingerprint = EXCLUDED.fingerprint
                              THEN video_assets.source_track_id ELSE NULL END,
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
    [modId, reg.agentKey, reg.fileName, reg.byteSize, reg.fingerprint],
  );
  return fromRow(rows[0]!);
};

/** What ffprobe read out of the file. */
export const setVideoAssetProbe = async (
  db: Tx,
  id: number,
  probe: VideoAssetProbe,
): Promise<void> => {
  await db.query(
    `UPDATE video_assets
        SET duration_s = $2, track_ids = $3::jsonb, source_track_id = $4, updated_at = NOW()
      WHERE id = $1`,
    [id, probe.durationS, JSON.stringify(probe.trackIds), probe.sourceTrackId],
  );
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

/** The narration is decoded: remember where, and move the row on from `registered`. */
export const setVideoAssetAudio = async (
  db: Tx,
  id: number,
  audioRelPath: string,
): Promise<void> => {
  await db.query(
    `UPDATE video_assets
        SET audio_rel_path = $2, error = NULL, updated_at = NOW(),
            status = CASE WHEN status = 'registered' THEN 'uploaded' ELSE status END
      WHERE id = $1`,
    [id, audioRelPath],
  );
};

/** Current mods of a Vortex group: the agent's own, and only their newest version. */
const GROUP_MODS = `SELECT id FROM mods WHERE vortex_group_id = $1 AND COALESCE(is_current, TRUE)`;

const listGroupAssets = async (db: Tx, groupId: number): Promise<VideoAssetRow[]> => {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM video_assets WHERE mod_id IN (${GROUP_MODS}) ORDER BY mod_id, file_name`,
    [groupId],
  );
  return rows.map(fromRow);
};

/** The videos of a group's mods whose file is not on the server (by hash). */
export const listVideoUploadTasks = async (db: Tx, groupId: number): Promise<VideoUploadTask[]> =>
  (await listGroupAssets(db, groupId))
    .filter((asset) => !videoFile(asset))
    .map((asset) => ({
      videoId: asset.id,
      modId: asset.mod_id,
      fileName: asset.file_name,
      fingerprint: asset.fingerprint,
    }));

/** The group's dubbed videos as the agent delivers them: every asset whose copy carries its current dub. */
export const listVideopackEntries = async (
  db: Tx,
  groupId: number,
): Promise<Array<{ asset: VideoAssetRow; file: string }>> => {
  const out: Array<{ asset: VideoAssetRow; file: string }> = [];
  for (const asset of await listGroupAssets(db, groupId)) {
    if (asset.packed_version == null || asset.packed_version !== asset.dub_version) continue;
    const file = videoPackedFile(asset);
    if (file) out.push({ asset, file });
  }
  return out;
};

/** What the agent is told about the group's videopack; null while no video is written. */
export const latestGroupVideopack = async (
  db: Tx,
  groupId: number,
): Promise<VortexLatestVideopack | null> => {
  const entries = await listVideopackEntries(db, groupId);
  if (entries.length === 0) return null;
  const version = sha1Hex(
    entries
      .map(({ asset }) => `${asset.file_name}:${asset.packed_version}`)
      .sort()
      .join('\n'),
  );
  return { version, videos: entries.length };
};

/** The dub version written into the asset's copy of the video (null: the copy is gone). */
export const setVideoAssetPacked = async (
  db: Tx,
  id: number,
  dubVersion: string | null,
): Promise<void> => {
  await db.query(
    `UPDATE video_assets
        SET packed_version = $2,
            status = CASE WHEN $2::text IS NOT NULL AND dub_version = $2 THEN 'packed'
                          WHEN $2::text IS NULL AND status = 'packed' THEN 'dubbed'
                          ELSE status END,
            updated_at = NOW()
      WHERE id = $1`,
    [id, dubVersion],
  );
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
