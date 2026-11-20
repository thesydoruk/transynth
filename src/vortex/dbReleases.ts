/** The game versions a Vortex group has seen, and which of them a machine runs. */
import type { Tx } from '../db';
import type { VortexGameReleaseHint } from './types';

/**
 * Record the game version a sync found. With a machine it becomes the version
 * that machine runs, and a version is current while some machine runs it — two
 * computers on different game versions keep both. A sync that names no machine
 * makes its version current as well.
 */
export const upsertCurrentGameRelease = async (
  db: Tx,
  groupId: number,
  hint: VortexGameReleaseHint,
  machineId: number | null = null,
): Promise<number | null> => {
  if (!hint.releaseHash) return null;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO vortex_game_releases (vortex_group_id, version_label, release_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (vortex_group_id, release_hash) DO UPDATE SET
       version_label = EXCLUDED.version_label
     RETURNING id`,
    [groupId, hint.versionLabel, hint.releaseHash],
  );
  const id = rows[0]?.id ?? null;
  if (id == null) return null;
  if (machineId != null) {
    await db.query(
      `UPDATE vortex_agents SET game_release_id = $2 WHERE id = $1 AND vortex_group_id = $3`,
      [machineId, id, groupId],
    );
  }
  await db.query(
    `UPDATE vortex_game_releases r
        SET is_current = (r.id = $2 AND $3::int IS NULL)
                         OR EXISTS (SELECT 1 FROM vortex_agents a WHERE a.game_release_id = r.id)
      WHERE r.vortex_group_id = $1`,
    [groupId, id, machineId],
  );
  return id;
};

export const listGameReleases = async (db: Tx, groupId: number) => {
  const { rows } = await db.query(
    `SELECT id, version_label, release_hash, is_current, created_at
     FROM vortex_game_releases
     WHERE vortex_group_id = $1
     ORDER BY created_at DESC`,
    [groupId],
  );
  return rows;
};
