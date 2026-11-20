/** The game versions a Vortex group has seen, and which of them a machine runs. */
import type { Tx } from '../db';
import type { VortexGameReleaseHint } from './types';

/**
 * Record the game version a sync found and make it the group's current one.
 * With a machine, the version is also recorded as the one that machine runs.
 */
export const upsertCurrentGameRelease = async (
  db: Tx,
  groupId: number,
  hint: VortexGameReleaseHint,
  machineId: number | null = null,
): Promise<number | null> => {
  if (!hint.releaseHash) return null;
  await db.query(`UPDATE vortex_game_releases SET is_current = FALSE WHERE vortex_group_id = $1`, [
    groupId,
  ]);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO vortex_game_releases (vortex_group_id, version_label, release_hash, is_current)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (vortex_group_id, release_hash) DO UPDATE SET
       version_label = EXCLUDED.version_label,
       is_current = TRUE
     RETURNING id`,
    [groupId, hint.versionLabel, hint.releaseHash],
  );
  const id = rows[0]?.id ?? null;
  if (id != null && machineId != null) {
    await db.query(
      `UPDATE vortex_agents SET game_release_id = $2 WHERE id = $1 AND vortex_group_id = $3`,
      [machineId, id, groupId],
    );
  }
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
