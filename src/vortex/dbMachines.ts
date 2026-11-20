/**
 * A machine of a Vortex group: one `vortex_agents` row per computer that syncs
 * into it. The mods are the group's — one row per content, shared by every
 * machine — while the mods a machine's staging holds, its load order, its game
 * version and its paths are that machine's own, so two computers on one group
 * do not overwrite each other.
 */
import type { Tx } from '../db';
import type { VortexExportOrder } from './types';

export type VortexMachinePaths = { stagingPath?: string | null; gameDir?: string | null };

/** The machine's row, made on first mention: an agent may plan before its first heartbeat. */
export const ensureVortexMachine = async (
  db: Tx,
  groupId: number,
  agentKey: string,
  paths: VortexMachinePaths = {},
): Promise<number> => {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO vortex_agents (vortex_group_id, agent_key, staging_path, game_dir)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (vortex_group_id, agent_key) DO UPDATE SET
       staging_path = COALESCE(EXCLUDED.staging_path, vortex_agents.staging_path),
       game_dir = COALESCE(EXCLUDED.game_dir, vortex_agents.game_dir)
     RETURNING id`,
    [groupId, agentKey, paths.stagingPath || null, paths.gameDir || null],
  );
  return rows[0]!.id;
};

/**
 * The machine a request is for: the one it names, else the group's only
 * machine (an agent older than machines names none). Null when it cannot be
 * told; the caller then works on the group as a whole.
 */
export const resolveVortexMachine = async (
  db: Tx,
  groupId: number,
  agentKey: unknown,
  paths: VortexMachinePaths = {},
): Promise<number | null> => {
  const key = typeof agentKey === 'string' ? agentKey.trim() : '';
  if (key) return ensureVortexMachine(db, groupId, key, paths);
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM vortex_agents WHERE vortex_group_id = $1 ORDER BY id LIMIT 2`,
    [groupId],
  );
  return rows.length === 1 ? rows[0]!.id : null;
};

export const setMachineExportOrder = async (
  db: Tx,
  machineId: number,
  order: VortexExportOrder,
): Promise<void> => {
  await db.query(`UPDATE vortex_agents SET export_order_json = $2::jsonb WHERE id = $1`, [
    machineId,
    JSON.stringify(order),
  ]);
};

/** The mods the machine's staging holds, as its last plan or import found them. */
export const setMachinePresentMods = async (
  db: Tx,
  machineId: number,
  modIds: number[],
): Promise<void> => {
  await db.query(`UPDATE vortex_agents SET present_mod_ids = $2::int[] WHERE id = $1`, [
    machineId,
    [...new Set(modIds)].sort((a, b) => a - b),
  ]);
};
