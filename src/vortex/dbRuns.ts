/** Run history and the "one run at a time" check for a Vortex group. */
import type { Tx } from '../db';
import type { VortexSyncRunRow } from './db';

const RUN_COLUMNS = `id, vortex_group_id, game, src_lang, tgt_lang, channel, status,
  current_stage, last_completed_stage, current_mod_id, job_id,
  export_archive_id, error, plan_json, stage, started_by, created_at, updated_at`;

export type VortexSyncRunHistoryRow = VortexSyncRunRow & {
  stage: string | null;
  started_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export const listVortexSyncRuns = async (
  db: Tx,
  groupId: number,
  limit = 20,
): Promise<VortexSyncRunHistoryRow[]> => {
  const { rows } = await db.query<VortexSyncRunHistoryRow>(
    `SELECT ${RUN_COLUMNS} FROM vortex_sync_runs
     WHERE vortex_group_id = $1 ORDER BY id DESC LIMIT $2`,
    [groupId, Math.max(1, Math.min(200, Math.trunc(limit)))],
  );
  return rows;
};

/** Every queued or running run of every group: what a worker reconciles on start. */
export const listUnfinishedVortexRuns = async (db: Tx): Promise<VortexSyncRunHistoryRow[]> => {
  const { rows } = await db.query<VortexSyncRunHistoryRow>(
    `SELECT ${RUN_COLUMNS} FROM vortex_sync_runs
     WHERE status IN ('queued', 'running') ORDER BY id`,
  );
  return rows;
};

/** The run still planning, queued or running for this group, if any. */
export const findActiveVortexRun = async (
  db: Tx,
  groupId: number,
): Promise<VortexSyncRunHistoryRow | null> => {
  const { rows } = await db.query<VortexSyncRunHistoryRow>(
    `SELECT ${RUN_COLUMNS} FROM vortex_sync_runs
     WHERE vortex_group_id = $1 AND status IN ('queued', 'running')
     ORDER BY id DESC LIMIT 1`,
    [groupId],
  );
  return rows[0] ?? null;
};
