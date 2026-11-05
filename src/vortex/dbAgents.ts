/**
 * The resident agent's side of the Vortex tables: heartbeat rows, the group's
 * current load order, and the newest langpack a run of the group produced.
 */
import type { Tx } from '../db';
import type { VortexAgentHeartbeat, VortexExportOrder, VortexLatestLangpack } from './types';

export type VortexAgentRow = {
  id: number;
  vortex_group_id: number;
  agent_key: string;
  agent_version: string | null;
  state: string;
  state_json: unknown;
  last_error: string | null;
  last_sync_at: Date | null;
  last_seen_at: Date;
};

const AGENT_COLUMNS = `id, vortex_group_id, agent_key, agent_version, state, state_json,
  last_error, last_sync_at, last_seen_at`;

export const upsertVortexAgent = async (
  db: Tx,
  groupId: number,
  beat: VortexAgentHeartbeat,
): Promise<VortexAgentRow> => {
  const stateJson = {
    pollSec: beat.pollSec,
    pending: beat.pending,
    lastRunId: beat.lastRunId,
    delivered: beat.delivered,
  };
  const { rows } = await db.query<VortexAgentRow>(
    `INSERT INTO vortex_agents
       (vortex_group_id, agent_key, agent_version, state, state_json, last_error, last_sync_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
     ON CONFLICT (vortex_group_id, agent_key) DO UPDATE SET
       agent_version = EXCLUDED.agent_version,
       state = EXCLUDED.state,
       state_json = EXCLUDED.state_json,
       last_error = EXCLUDED.last_error,
       last_sync_at = EXCLUDED.last_sync_at,
       last_seen_at = NOW()
     RETURNING ${AGENT_COLUMNS}`,
    [
      groupId,
      beat.agentKey,
      beat.agentVersion,
      beat.state,
      JSON.stringify(stateJson),
      beat.lastError,
      beat.lastSyncAt,
    ],
  );
  return rows[0]!;
};

/** The agent seen most recently for a group, or null when none ever reported. */
export const getVortexAgentForGroup = async (
  db: Tx,
  groupId: number,
): Promise<VortexAgentRow | null> => {
  const { rows } = await db.query<VortexAgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM vortex_agents
     WHERE vortex_group_id = $1 ORDER BY last_seen_at DESC LIMIT 1`,
    [groupId],
  );
  return rows[0] ?? null;
};

export const setGroupExportOrder = async (
  db: Tx,
  groupId: number,
  order: VortexExportOrder,
): Promise<void> => {
  // Not `updated_at`: that column orders the group list and the agent writes often.
  await db.query(`UPDATE vortex_groups SET export_order_json = $2::jsonb WHERE id = $1`, [
    groupId,
    JSON.stringify(order),
  ]);
};

export const getGroupExportOrder = async (
  db: Tx,
  groupId: number,
): Promise<VortexExportOrder | null> => {
  const { rows } = await db.query<{ export_order_json: VortexExportOrder | null }>(
    `SELECT export_order_json FROM vortex_groups WHERE id = $1`,
    [groupId],
  );
  return rows[0]?.export_order_json ?? null;
};

/** The newest completed export archive any run of this group produced. */
export const getLatestGroupLangpack = async (
  db: Tx,
  groupId: number,
): Promise<VortexLatestLangpack | null> => {
  const { rows } = await db.query<{
    archive_id: number;
    run_id: number;
    file_name: string;
    byte_size: string | null;
  }>(
    `SELECT a.id AS archive_id, r.id AS run_id, a.file_name, a.byte_size
     FROM vortex_sync_runs r
     JOIN export_archives a ON a.id = r.export_archive_id
     WHERE r.vortex_group_id = $1 AND a.status = 'completed' AND a.rel_path IS NOT NULL
     ORDER BY a.id DESC LIMIT 1`,
    [groupId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    archiveId: row.archive_id,
    runId: row.run_id,
    fileName: row.file_name,
    byteSize: row.byte_size == null ? null : Number(row.byte_size),
  };
};
