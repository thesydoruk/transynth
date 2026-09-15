import type { Tx } from '../db';
import type { GameId } from '../types';
import { scopedVortexFileHash } from './groupKey';
import type { VortexChannel } from './stages';
import type { VortexGameReleaseHint, VortexPlanPayload, VortexPlanUnit } from './types';

export type VortexGroupRow = {
  id: number;
  game: string;
  group_key: string;
  label: string;
  staging_path: string | null;
  game_dir: string | null;
};

export type VortexSyncRunRow = {
  id: number;
  vortex_group_id: number;
  game: string;
  src_lang: string;
  tgt_lang: string;
  channel: string;
  status: string;
  current_stage: string | null;
  last_completed_stage: string | null;
  current_mod_id: number | null;
  job_id: number | null;
  export_archive_id: number | null;
  error: string | null;
  plan_json: unknown;
};

export const getOrCreateVortexGroup = async (
  db: Tx,
  params: {
    game: GameId;
    groupKey: string;
    label: string;
    stagingPath: string;
    gameDir: string;
  },
): Promise<VortexGroupRow> => {
  const { rows } = await db.query<VortexGroupRow>(
    `INSERT INTO vortex_groups (game, group_key, label, staging_path, game_dir)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (game, group_key) DO UPDATE SET
       label = EXCLUDED.label,
       staging_path = EXCLUDED.staging_path,
       game_dir = EXCLUDED.game_dir,
       updated_at = NOW()
     RETURNING id, game, group_key, label, staging_path, game_dir`,
    [params.game, params.groupKey, params.label, params.stagingPath, params.gameDir],
  );
  return rows[0]!;
};

export const listVortexGroups = async (db: Tx, game?: string): Promise<VortexGroupRow[]> => {
  if (game) {
    const { rows } = await db.query<VortexGroupRow>(
      `SELECT id, game, group_key, label, staging_path, game_dir
       FROM vortex_groups WHERE game = $1 ORDER BY updated_at DESC`,
      [game],
    );
    return rows;
  }
  const { rows } = await db.query<VortexGroupRow>(
    `SELECT id, game, group_key, label, staging_path, game_dir
     FROM vortex_groups ORDER BY updated_at DESC`,
  );
  return rows;
};

export const getVortexGroup = async (db: Tx, id: number): Promise<VortexGroupRow | undefined> => {
  const { rows } = await db.query<VortexGroupRow>(
    `SELECT id, game, group_key, label, staging_path, game_dir FROM vortex_groups WHERE id = $1`,
    [id],
  );
  return rows[0];
};

export const getVortexGroupByKey = async (
  db: Tx,
  game: string,
  groupKey: string,
): Promise<VortexGroupRow | undefined> => {
  const { rows } = await db.query<VortexGroupRow>(
    `SELECT id, game, group_key, label, staging_path, game_dir
     FROM vortex_groups WHERE game = $1 AND group_key = $2`,
    [game, groupKey],
  );
  return rows[0];
};

export const upsertCurrentGameRelease = async (
  db: Tx,
  groupId: number,
  hint: VortexGameReleaseHint,
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
  return rows[0]?.id ?? null;
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

export const insertVortexSyncRun = async (
  db: Tx,
  params: {
    groupId: number;
    game: GameId;
    srcLang: string;
    tgtLang: string;
    channel: VortexChannel;
    plan: unknown;
  },
): Promise<VortexSyncRunRow> => {
  const { rows } = await db.query<VortexSyncRunRow>(
    `INSERT INTO vortex_sync_runs
       (vortex_group_id, game, src_lang, tgt_lang, channel, status, plan_json)
     VALUES ($1, $2, $3, $4, $5, 'planning', $6::jsonb)
     RETURNING id, vortex_group_id, game, src_lang, tgt_lang, channel, status,
               current_stage, last_completed_stage, current_mod_id, job_id,
               export_archive_id, error, plan_json`,
    [
      params.groupId,
      params.game,
      params.srcLang,
      params.tgtLang,
      params.channel,
      JSON.stringify(params.plan),
    ],
  );
  return rows[0]!;
};

export const getLatestVortexSyncRun = async (
  db: Tx,
  groupId: number,
): Promise<VortexSyncRunRow | undefined> => {
  const { rows } = await db.query<VortexSyncRunRow>(
    `SELECT id, vortex_group_id, game, src_lang, tgt_lang, channel, status,
            current_stage, last_completed_stage, current_mod_id, job_id,
            export_archive_id, error, plan_json
     FROM vortex_sync_runs WHERE vortex_group_id = $1
     ORDER BY id DESC LIMIT 1`,
    [groupId],
  );
  return rows[0];
};

export const getVortexSyncRun = async (
  db: Tx,
  id: number,
): Promise<VortexSyncRunRow | undefined> => {
  const { rows } = await db.query<VortexSyncRunRow>(
    `SELECT id, vortex_group_id, game, src_lang, tgt_lang, channel, status,
            current_stage, last_completed_stage, current_mod_id, job_id,
            export_archive_id, error, plan_json
     FROM vortex_sync_runs WHERE id = $1`,
    [id],
  );
  return rows[0];
};

export const updateVortexSyncRun = async (
  db: Tx,
  id: number,
  patch: Partial<{
    status: string;
    current_stage: string | null;
    last_completed_stage: string | null;
    current_mod_id: number | null;
    job_id: number | null;
    export_archive_id: number | null;
    error: string | null;
    plan_json: unknown;
  }>,
): Promise<void> => {
  await db.query(
    `UPDATE vortex_sync_runs SET
       status = COALESCE($2, status),
       current_stage = COALESCE($3, current_stage),
       last_completed_stage = COALESCE($4, last_completed_stage),
       current_mod_id = COALESCE($5, current_mod_id),
       job_id = COALESCE($6, job_id),
       export_archive_id = COALESCE($7, export_archive_id),
       error = COALESCE($8, error),
       plan_json = COALESCE($9::jsonb, plan_json),
       updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.current_stage ?? null,
      patch.last_completed_stage ?? null,
      patch.current_mod_id ?? null,
      patch.job_id ?? null,
      patch.export_archive_id ?? null,
      patch.error ?? null,
      patch.plan_json != null ? JSON.stringify(patch.plan_json) : null,
    ],
  );
};

export const planVortexUnits = async (
  db: Tx,
  groupId: number,
  payload: VortexPlanPayload,
): Promise<VortexPlanUnit[]> => {
  const planned: VortexPlanUnit[] = [];
  for (const unit of payload.units) {
    const scoped = scopedVortexFileHash(groupId, unit.contentHash);
    const { rows: jobs } = await db.query<{ id: number; mod_id: number | null; status: string }>(
      `SELECT id, mod_id, status FROM mod_imports
       WHERE file_hash = $1 LIMIT 1`,
      [scoped],
    );
    const job = jobs[0];
    const meta = {
      pluginStem: unit.pluginStem,
      pluginFileName: unit.pluginFileName,
      sourceFolder: unit.sourceFolder,
      nexusModId: unit.nexusModId,
      nexusModName: unit.nexusModName,
    };
    if (job?.status === 'completed' && job.mod_id) {
      planned.push({
        unitId: unit.unitId,
        action: 'skip',
        channel: unit.channel,
        name: unit.name,
        contentHash: unit.contentHash,
        scopedFileHash: scoped,
        existingModId: job.mod_id,
        existingJobId: job.id,
        ...meta,
      });
      continue;
    }

    const { rows: prev } = await db.query<{ id: number }>(
      unit.nexusModId
        ? `SELECT id FROM mods
           WHERE vortex_group_id = $1 AND nexus_mod_id = $2 AND version_hash <> $3
           ORDER BY created_at DESC LIMIT 1`
        : `SELECT id FROM mods
           WHERE vortex_group_id = $1 AND name = $2 AND version_hash <> $3
           ORDER BY created_at DESC LIMIT 1`,
      unit.nexusModId
        ? [groupId, unit.nexusModId, unit.contentHash]
        : [groupId, unit.name, unit.contentHash],
    );

    planned.push({
      unitId: unit.unitId,
      action: prev[0] ? 'update' : 'upload',
      channel: unit.channel,
      name: unit.name,
      contentHash: unit.contentHash,
      scopedFileHash: scoped,
      existingModId: prev[0]?.id ?? job?.mod_id ?? null,
      existingJobId: job?.id ?? null,
      ...meta,
    });
  }
  return planned;
};

export const findPreviousVortexMod = async (
  db: Tx,
  params: { groupId: number; newModId: number; nexusModId?: number | null; name: string },
): Promise<number | null> => {
  if (params.nexusModId) {
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM mods
       WHERE vortex_group_id = $1 AND nexus_mod_id = $2 AND id <> $3
       ORDER BY created_at DESC LIMIT 1`,
      [params.groupId, params.nexusModId, params.newModId],
    );
    if (rows[0]) return rows[0].id;
  }
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM mods
     WHERE vortex_group_id = $1 AND name = $2 AND id <> $3
     ORDER BY created_at DESC LIMIT 1`,
    [params.groupId, params.name, params.newModId],
  );
  return rows[0]?.id ?? null;
};

export const listCurrentGroupModIds = async (
  db: Tx,
  groupId: number,
  channel: VortexChannel,
): Promise<number[]> => {
  const conds = ['m.vortex_group_id = $1'];
  const params: unknown[] = [groupId];
  if (channel === 'mods') conds.push(`m.channel = 'mods'`);
  if (channel === 'game') {
    conds.push(`m.channel = 'game'`);
    conds.push(`(m.game_release_id IS NULL OR m.game_release_id = (
      SELECT id FROM vortex_game_releases
      WHERE vortex_group_id = $1 AND is_current = TRUE
      ORDER BY created_at DESC LIMIT 1
    ))`);
  } else {
    conds.push(`(
      m.channel IS DISTINCT FROM 'game'
      OR m.game_release_id IS NULL
      OR m.game_release_id = (
        SELECT id FROM vortex_game_releases
        WHERE vortex_group_id = $1 AND is_current = TRUE
        ORDER BY created_at DESC LIMIT 1
      )
    )`);
  }
  conds.push(`COALESCE(m.is_current, TRUE)`);
  const { rows } = await db.query<{ id: number }>(
    `SELECT m.id FROM mods m WHERE ${conds.join(' AND ')} ORDER BY m.name`,
    params,
  );
  return rows.map((row) => row.id);
};

export type VortexExportModRow = {
  id: number;
  name: string;
  channel: string | null;
  abs_path: string | null;
  source_folder: string | null;
};

export const listVortexExportModRows = async (
  db: Tx,
  ids: number[],
): Promise<VortexExportModRow[]> => {
  if (ids.length === 0) return [];
  const { rows } = await db.query<VortexExportModRow>(
    `SELECT m.id, m.name, m.channel, m.abs_path, i.source_folder
     FROM mods m
     LEFT JOIN LATERAL (
       SELECT source_folder FROM mod_imports
       WHERE mod_id = m.id
       ORDER BY id DESC
       LIMIT 1
     ) i ON TRUE
     WHERE m.id = ANY($1::int[])`,
    [ids],
  );
  return rows;
};

/** Mark staging-present mods as current; older siblings in the same family stay archived. */
export const markCurrentVortexMods = async (
  db: Tx,
  groupId: number,
  presentModIds: number[],
): Promise<void> => {
  if (presentModIds.length === 0) return;
  await db.query(
    `WITH present AS (
       SELECT id, nexus_mod_id, name, channel, created_at
       FROM mods
       WHERE vortex_group_id = $1 AND id = ANY($2::int[])
     ),
     newest AS (
       SELECT DISTINCT ON (
         COALESCE('n:' || nexus_mod_id::text, 'm:' || lower(name)),
         COALESCE(channel, '')
       ) id
       FROM present
       ORDER BY COALESCE('n:' || nexus_mod_id::text, 'm:' || lower(name)),
                COALESCE(channel, ''),
                created_at DESC
     ),
     siblings AS (
       SELECT m.id
       FROM mods m
       JOIN present p
         ON COALESCE('n:' || m.nexus_mod_id::text, 'm:' || lower(m.name))
          = COALESCE('n:' || p.nexus_mod_id::text, 'm:' || lower(p.name))
        AND m.channel IS NOT DISTINCT FROM p.channel
       WHERE m.vortex_group_id = $1
     )
     UPDATE mods m SET is_current = (m.id IN (SELECT id FROM newest))
     WHERE m.id IN (SELECT id FROM siblings)`,
    [groupId, presentModIds],
  );
};
