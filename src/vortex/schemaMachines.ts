/**
 * What a machine of a group owns (dbMachines.ts), kept on its `vortex_agents`
 * row, and the machine a run was made for. Mirrored in sql/schema.sql.
 */
import type { Tx } from '../db';

/**
 * A group synced before machines existed has its state on the group alone.
 * The machine seen last takes it over, once: the group's current mods, its
 * load order, its game version, its paths and every run so far. A group where
 * some machine already holds mods is left alone.
 */
export const ADOPT_GROUP_STATE_SQL = `
  WITH adopter AS (
    SELECT DISTINCT ON (a.vortex_group_id) a.id
    FROM vortex_agents a
    WHERE NOT EXISTS (
      SELECT 1 FROM vortex_agents o
      WHERE o.vortex_group_id = a.vortex_group_id AND o.present_mod_ids IS NOT NULL
    )
    ORDER BY a.vortex_group_id, a.last_seen_at DESC, a.id DESC
  ),
  adopted AS (
    UPDATE vortex_agents a SET
      present_mod_ids = COALESCE(
        (SELECT array_agg(m.id ORDER BY m.id) FROM mods m
          WHERE m.vortex_group_id = a.vortex_group_id AND COALESCE(m.is_current, TRUE)),
        '{}'),
      export_order_json = COALESCE(a.export_order_json, g.export_order_json),
      game_release_id = COALESCE(a.game_release_id, (
        SELECT r.id FROM vortex_game_releases r
         WHERE r.vortex_group_id = a.vortex_group_id AND r.is_current
         ORDER BY r.created_at DESC LIMIT 1)),
      staging_path = COALESCE(a.staging_path, g.staging_path),
      game_dir = COALESCE(a.game_dir, g.game_dir)
    FROM adopter, vortex_groups g
    WHERE a.id = adopter.id AND g.id = a.vortex_group_id
    RETURNING a.id, a.vortex_group_id
  )
  UPDATE vortex_sync_runs r SET agent_id = adopted.id
  FROM adopted
  WHERE r.vortex_group_id = adopted.vortex_group_id AND r.agent_id IS NULL`;

export const ensureVortexMachineSchema = async (db: Tx): Promise<void> => {
  await db.query(`ALTER TABLE vortex_agents ADD COLUMN IF NOT EXISTS staging_path TEXT`);
  await db.query(`ALTER TABLE vortex_agents ADD COLUMN IF NOT EXISTS game_dir TEXT`);
  await db.query(`ALTER TABLE vortex_agents ADD COLUMN IF NOT EXISTS export_order_json JSONB`);
  await db.query(`ALTER TABLE vortex_agents ADD COLUMN IF NOT EXISTS present_mod_ids INTEGER[]`);
  await db.query(
    `ALTER TABLE vortex_agents ADD COLUMN IF NOT EXISTS game_release_id INTEGER REFERENCES vortex_game_releases(id) ON DELETE SET NULL`,
  );
  await db.query(
    `ALTER TABLE vortex_sync_runs ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES vortex_agents(id) ON DELETE SET NULL`,
  );
  await db.query(ADOPT_GROUP_STATE_SQL);
};
