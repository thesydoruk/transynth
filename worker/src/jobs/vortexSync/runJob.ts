/**
 * One Vortex run. Either an in-process range (`import` → `carry`, or `export`)
 * or one fan-out stage (`tm`, `llm`, `verify`, `skip`, `gender`, `voice`) that
 * enqueues the per-mod jobs one at a time — see fanOutStage.ts.
 */
import type { Tx } from '../../../../src/db';
import { carryOverTranslations } from '../../../../src/web/data/queries/importDiff';
import { reuseSynthesizedVoice } from '../../../../src/voice/reuseSynthesizedVoice';
import { invalidateVoiceListContext } from '../../../../src/web/voice/preview/voiceListContext';
import { runModImport } from '../../../../src/import/mod/run/runImport';
import { getModImportJob } from '../../../../src/import/mod/jobs';
import { log } from '../../../../src/logger';
import {
  findPreviousVortexMod,
  getVortexSyncRun,
  listCurrentGroupModIds,
  markCurrentVortexMods,
  updateVortexSyncRun,
  upsertCurrentGameRelease,
  type VortexSyncRunRow,
} from '../../../../src/vortex/db';
import {
  isFanOutStage,
  type ServerVortexStage,
  type VortexFanOutStage,
} from '../../../../src/vortex/stages';
import { findActiveJobIdForMod } from '../../api/jobStatus';
import { startBackgroundJob } from '../../api/startBackgroundJob';
import { requestJobStop } from '../../core/queue';
import { readJobSnapshot } from '../../core/snapshots';
import type { JobResult } from '../../types';
import { runExportStage, planUnits } from './exportStage';
import { runFanOutStage, type FanOutStageOptions } from './fanOutStage';

export type VortexSyncJobParams = {
  runId: number;
  /** In-process range (CLI / agent): import→carry or export. */
  from?: ServerVortexStage;
  to?: ServerVortexStage;
  /** One fan-out stage (UI button / agent TM). */
  stage?: VortexFanOutStage;
  modIds?: number[];
  options?: FanOutStageOptions;
};

const IN_PROCESS_ORDER: ServerVortexStage[] = ['import', 'carry', 'export'];

const sliceStages = (from: ServerVortexStage, to: ServerVortexStage): ServerVortexStage[] => {
  const start = IN_PROCESS_ORDER.indexOf(from);
  const end = IN_PROCESS_ORDER.indexOf(to);
  if (start < 0 || end < 0 || start > end) {
    throw new Error(`Invalid server stage range: ${from}..${to}`);
  }
  return IN_PROCESS_ORDER.slice(start, end + 1);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RunOpts = { jobId: number; isCancelled: () => boolean };

const runImportStage = async (db: Tx, run: VortexSyncRunRow): Promise<number[]> => {
  const importedModIds: number[] = [];
  for (const unit of planUnits(run)) {
    if (unit.action === 'skip' && unit.existingModId) {
      importedModIds.push(unit.existingModId);
      continue;
    }
    if (!unit.existingJobId) continue;
    const job = await getModImportJob(db, unit.existingJobId);
    if (!job) continue;
    if (job.status === 'completed' && job.mod_id) {
      importedModIds.push(job.mod_id);
      continue;
    }
    log.info(`Vortex sync: importing ${unit.name} (job #${job.id})`);
    const result = await runModImport(db, job);
    if (result.mod_id) importedModIds.push(result.mod_id);
  }
  const hint = (run.plan_json as { gameRelease?: { versionLabel: string; releaseHash: string } })
    ?.gameRelease;
  if (hint?.releaseHash) {
    const releaseId = await upsertCurrentGameRelease(db, run.vortex_group_id, hint);
    if (releaseId) {
      await db.query(
        `UPDATE mods SET game_release_id = $1,
               version_label = COALESCE(NULLIF(version_label, ''), $4)
         WHERE vortex_group_id = $2 AND channel = 'game' AND id = ANY($3::int[])`,
        [releaseId, run.vortex_group_id, importedModIds, hint.versionLabel],
      );
    }
  }
  await markCurrentVortexMods(db, run.vortex_group_id, importedModIds);
  return importedModIds;
};

const runCarryStage = async (db: Tx, run: VortexSyncRunRow, modIds: number[]): Promise<void> => {
  for (const modId of modIds) {
    const { rows } = await db.query<{ name: string; nexus_mod_id: number | null }>(
      `SELECT name, nexus_mod_id FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = rows[0];
    if (!mod) continue;
    await updateVortexSyncRun(db, run.id, { current_stage: 'carry', current_mod_id: modId });
    const prev = await findPreviousVortexMod(db, {
      groupId: run.vortex_group_id,
      newModId: modId,
      nexusModId: mod.nexus_mod_id,
      name: mod.name,
    });
    if (prev) await carryOverTranslations(db, modId, prev, run.tgt_lang, run.src_lang);
    const voice = await reuseSynthesizedVoice(db, modId, run.tgt_lang);
    if (voice.copied > 0) {
      invalidateVoiceListContext(modId);
      log.info(`Vortex sync: copied ${voice.copied} synthesized take(s) into mod ${modId}`);
    }
  }
};

const stageMods = async (db: Tx, run: VortexSyncRunRow, modIds?: number[]) => {
  const ids =
    modIds && modIds.length > 0
      ? modIds
      : await listCurrentGroupModIds(
          db,
          run.vortex_group_id,
          run.channel as 'all' | 'mods' | 'game',
        );
  if (ids.length === 0) return [];
  const { rows } = await db.query<{ id: number; name: string; game: string }>(
    `SELECT id, name, game FROM mods WHERE id = ANY($1::int[]) ORDER BY name`,
    [ids],
  );
  return rows;
};

const runFanOut = async (
  db: Tx,
  run: VortexSyncRunRow,
  params: VortexSyncJobParams,
  opts: RunOpts,
): Promise<JobResult> => {
  const stage = params.stage!;
  await updateVortexSyncRun(db, run.id, { current_stage: stage });
  const mods = await stageMods(db, run, params.modIds);
  if (mods.length === 0) throw new Error('No mods in Vortex group for this stage');
  const modJobs = await runFanOutStage(db, run, stage, mods, params.options ?? {}, opts, {
    enqueue: startBackgroundJob,
    readSnapshot: readJobSnapshot,
    isBusy: async (kinds, modId) => (await findActiveJobIdForMod(kinds, modId)) != null,
    stop: requestJobStop,
    sleep,
    pollMs: 2000,
  });
  const failed = modJobs.filter((job) => job.status === 'failed');
  const cancelled = modJobs.some((job) => job.status === 'cancelled');
  const done = modJobs.filter((job) => job.status === 'completed').length;
  if (cancelled) {
    await updateVortexSyncRun(db, run.id, { status: 'cancelled', current_stage: null });
    return { status: 'cancelled', error: null, done, total: modJobs.length };
  }
  if (failed.length > 0) {
    const error = `${stage}: ${failed.map((job) => `${job.name}: ${job.error ?? 'failed'}`).join('; ')}`;
    await updateVortexSyncRun(db, run.id, { status: 'failed', error, current_stage: null });
    return { status: 'failed', error, done, total: modJobs.length };
  }
  await updateVortexSyncRun(db, run.id, {
    status: 'completed',
    current_stage: null,
    last_completed_stage: stage,
  });
  return { status: 'completed', error: null, done, total: modJobs.length };
};

export const runVortexSyncJob = async (
  db: Tx,
  params: VortexSyncJobParams,
  opts: RunOpts,
): Promise<JobResult> => {
  const run = await getVortexSyncRun(db, params.runId);
  if (!run) throw new Error(`Vortex sync run ${params.runId} not found`);
  await updateVortexSyncRun(db, run.id, { status: 'running', job_id: opts.jobId });

  try {
    if (params.stage) {
      if (!isFanOutStage(params.stage)) throw new Error(`Not a fan-out stage: ${params.stage}`);
      return await runFanOut(db, run, params, opts);
    }
    const stages = sliceStages(params.from ?? 'import', params.to ?? 'carry');
    let importedModIds: number[] = [];
    for (const stage of stages) {
      if (opts.isCancelled()) {
        await updateVortexSyncRun(db, run.id, { status: 'cancelled' });
        return { status: 'cancelled', error: null, done: 0, total: stages.length };
      }
      await updateVortexSyncRun(db, run.id, { current_stage: stage });
      if (stage === 'import') importedModIds = await runImportStage(db, run);
      if (stage === 'carry') {
        const targets =
          importedModIds.length > 0
            ? importedModIds
            : await listCurrentGroupModIds(
                db,
                run.vortex_group_id,
                run.channel as 'all' | 'mods' | 'game',
              );
        await runCarryStage(db, run, targets);
      }
      if (stage === 'export') await runExportStage(db, run, opts);
      await updateVortexSyncRun(db, run.id, { last_completed_stage: stage });
    }
    await updateVortexSyncRun(db, run.id, { status: 'completed', current_stage: null });
    return { status: 'completed', error: null, done: stages.length, total: stages.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateVortexSyncRun(db, run.id, { status: 'failed', error: message });
    throw err;
  }
};
