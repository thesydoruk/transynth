/**
 * A machine of a Vortex group: one `vortex_agents` row per computer that syncs
 * into it. The mods are the group's — one row per content, shared by every
 * machine — while the mods a machine's staging holds, its load order, its game
 * version and its paths are that machine's own, so two computers on one group
 * do not overwrite each other.
 */
import type { Tx } from '../db';
import { listCurrentGroupModIds, type VortexSyncRunRow } from './db';
import { AGENT_COLUMNS, type VortexAgentRow } from './dbAgents';
import { modFamilySql } from './family';
import type { VortexChannel } from './stages';
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

/**
 * The machine a stage is started for: the page names it by id, the agent by
 * its key. A stage that needs one (`required`: an export is one machine's
 * mods, load order and langpack) takes the group's only machine when none is
 * named and refuses to guess between several; any other stage then goes over
 * the whole group.
 */
export const resolveStageMachine = async (
  db: Tx,
  groupId: number,
  named: { agentId?: unknown; agentKey?: unknown; required: boolean },
): Promise<{ machineId: number | null } | { error: string }> => {
  if (typeof named.agentId === 'number' && Number.isInteger(named.agentId)) {
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM vortex_agents WHERE id = $1 AND vortex_group_id = $2`,
      [named.agentId, groupId],
    );
    return rows[0] ? { machineId: rows[0].id } : { error: 'No such machine in this group' };
  }
  if (typeof named.agentKey === 'string' && named.agentKey.trim()) {
    return { machineId: await ensureVortexMachine(db, groupId, named.agentKey.trim()) };
  }
  if (!named.required) return { machineId: null };
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM vortex_agents WHERE vortex_group_id = $1 ORDER BY id LIMIT 2`,
    [groupId],
  );
  if (rows.length > 1) {
    return { error: 'Several machines sync this group: name the one this is for (agentId)' };
  }
  return { machineId: rows[0]?.id ?? null };
};

/**
 * Forget a machine that no longer syncs (a retired computer, a renamed host):
 * the versions only it held are archived again where another machine holds a
 * sibling. Its runs stay, without a machine. False when the group has no such machine.
 */
export const forgetVortexMachine = async (
  db: Tx,
  groupId: number,
  machineId: number,
): Promise<boolean> => {
  const { rowCount } = await db.query(
    `DELETE FROM vortex_agents WHERE id = $1 AND vortex_group_id = $2`,
    [machineId, groupId],
  );
  if (!rowCount) return false;
  await markCurrentAcrossMachines(db, groupId);
  return true;
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

const PRESENT_ON_MACHINES = `
  SELECT a.id AS machine_id, m.id, m.vortex_plugin, m.nexus_mod_id, m.name, m.channel, m.created_at
  FROM vortex_agents a
  JOIN mods m ON m.id = ANY(a.present_mod_ids) AND m.vortex_group_id = a.vortex_group_id`;

/** Per machine, the newest present mod of each family: what that machine runs. */
const NEWEST_PER_MACHINE = `
  SELECT DISTINCT ON (p.machine_id, ${modFamilySql('p')}, COALESCE(p.channel, '')) p.id, p.name
  FROM present p
  ORDER BY p.machine_id, ${modFamilySql('p')}, COALESCE(p.channel, ''), p.created_at DESC`;

/**
 * A version is current while some machine of the group runs it; its siblings
 * no machine runs are archived. So one computer's sync never archives the
 * version another one still has. A family no machine holds is left as it was.
 */
export const markCurrentAcrossMachines = async (db: Tx, groupId: number): Promise<void> => {
  await db.query(
    `WITH present AS (${PRESENT_ON_MACHINES} WHERE a.vortex_group_id = $1),
     newest AS (${NEWEST_PER_MACHINE}),
     siblings AS (
       SELECT m.id
       FROM mods m
       JOIN present p
         ON ${modFamilySql('m')} = ${modFamilySql('p')}
        AND m.channel IS NOT DISTINCT FROM p.channel
       WHERE m.vortex_group_id = $1
     )
     UPDATE mods m SET is_current = (m.id IN (SELECT id FROM newest))
     WHERE m.id IN (SELECT id FROM siblings)`,
    [groupId],
  );
};

/**
 * The mods one machine runs, by name; null when the machine has not reported
 * its mods yet (the caller then takes the group's current ones).
 */
export const listMachineModIds = async (
  db: Tx,
  machineId: number,
  channel: VortexChannel,
): Promise<number[] | null> => {
  const { rows: known } = await db.query(
    `SELECT 1 FROM vortex_agents WHERE id = $1 AND present_mod_ids IS NOT NULL`,
    [machineId],
  );
  if (known.length === 0) return null;
  const { rows } = await db.query<{ id: number }>(
    `WITH present AS (
       ${PRESENT_ON_MACHINES}
       WHERE a.id = $1 AND ($2 = 'all' OR m.channel = $2)
     )
     SELECT n.id FROM (${NEWEST_PER_MACHINE}) n ORDER BY n.name`,
    [machineId, channel],
  );
  return rows.map((row) => row.id);
};

/** The mods a run works on: its machine's, or the group's current ones when it names none. */
export const listRunModIds = async (
  db: Tx,
  run: Pick<VortexSyncRunRow, 'vortex_group_id' | 'channel' | 'agent_id'>,
): Promise<number[]> => {
  const channel = run.channel as VortexChannel;
  const own = run.agent_id != null ? await listMachineModIds(db, run.agent_id, channel) : null;
  return own ?? listCurrentGroupModIds(db, run.vortex_group_id, channel);
};

/** The load order an export follows: the machine's, or the group's when no machine is named. */
export const getExportOrderFor = async (
  db: Tx,
  groupId: number,
  machineId: number | null,
): Promise<VortexExportOrder | null> => {
  const { rows } = await db.query<{ export_order_json: VortexExportOrder | null }>(
    machineId == null
      ? `SELECT export_order_json FROM vortex_groups WHERE id = $1`
      : `SELECT export_order_json FROM vortex_agents WHERE vortex_group_id = $1 AND id = $2`,
    machineId == null ? [groupId] : [groupId, machineId],
  );
  return rows[0]?.export_order_json ?? null;
};

export type VortexMachineRow = VortexAgentRow & {
  /** How many mods its staging holds; null before its first sync. */
  mod_count: number | null;
  /** The game version it runs, as its last sync read it. */
  game_version: string | null;
};

/** Every machine of the group, the one seen last first. */
export const listVortexMachines = async (db: Tx, groupId: number): Promise<VortexMachineRow[]> => {
  const { rows } = await db.query<VortexMachineRow>(
    `SELECT ${AGENT_COLUMNS},
            cardinality(present_mod_ids) AS mod_count,
            (SELECT r.version_label FROM vortex_game_releases r
              WHERE r.id = vortex_agents.game_release_id) AS game_version
     FROM vortex_agents
     WHERE vortex_group_id = $1
     ORDER BY last_seen_at DESC, id`,
    [groupId],
  );
  return rows;
};
