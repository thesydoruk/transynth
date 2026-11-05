/**
 * The Vortex page's buttons: start one stage for a group, stop a run, read a run.
 *
 *   POST /api/vortex/groups/:id/stage/:stage — a new run for one stage; refused when a
 *        run is active or the stage needs a service kind without a healthy host
 *   POST /api/vortex/sync/:runId/stop
 *   GET  /api/vortex/sync/:runId                — the run row with live per-mod progress
 */
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { probeKindsHealthy } from '../../services/kindHealth';
import type { GameId } from '../../types';
import { readJobStatus } from '../../../worker/src/api/jobStatus';
import { startBackgroundJob } from '../../../worker/src/api/startBackgroundJob';
import { requestJobStop } from '../../../worker/src/core/queue';
import type { VortexModJob } from '../../../worker/src/jobs/vortexSync/fanOutStage';
import { getVortexGroup, getVortexSyncRun, insertVortexSyncRun } from '../../vortex/db';
import { getGroupExportOrder } from '../../vortex/dbAgents';
import { findActiveVortexRun } from '../../vortex/dbRuns';
import {
  STAGE_JOB_KIND,
  STAGE_NEEDS,
  isFanOutStage,
  isServerVortexStage,
  isVortexChannel,
  type ServerVortexStage,
} from '../../vortex/stages';
import { parseRouteId } from './parseRouteId';

/** Stages a button may start: everything the server runs except the agent-only import/carry. */
const BUTTON_STAGES: readonly ServerVortexStage[] = [
  'tm',
  'llm',
  'verify',
  'skip',
  'gender',
  'voice',
  'export',
];

const SERVICE_LABEL: Record<string, string> = { llm: 'LLM', embed: 'embedding', tts: 'TTS' };

type StageBody = {
  channel?: string;
  modIds?: number[];
  options?: Record<string, unknown>;
  startedBy?: 'ui' | 'agent';
};

const modJobsOf = (run: { plan_json: unknown }): VortexModJob[] => {
  const raw = run.plan_json as { modJobs?: VortexModJob[] } | null;
  return Array.isArray(raw?.modJobs) ? raw.modJobs : [];
};

/** The run row plus per-mod jobs refreshed from Redis while they still run. */
export const describeVortexRun = async (
  run: NonNullable<Awaited<ReturnType<typeof getVortexSyncRun>>>,
  readStatus: typeof readJobStatus = readJobStatus,
) => {
  const modJobs = await Promise.all(
    modJobsOf(run).map(async (job) => {
      if (job.status !== 'running' || job.jobId == null) return job;
      const live = await readStatus(job.jobId, [job.kind]);
      return live
        ? {
            ...job,
            status: (live.status as VortexModJob['status']) ?? job.status,
            done: Number(live.done ?? job.done),
            total: Number(live.total ?? job.total),
            error: (live.error as string | null) ?? null,
          }
        : job;
    }),
  );
  const terminal = modJobs.filter((job) => job.status !== 'queued' && job.status !== 'running');
  const progress =
    modJobs.length > 0
      ? { done: terminal.length, total: modJobs.length }
      : await (async () => {
          const live = run.job_id ? await readStatus(run.job_id, ['vortex-sync']) : null;
          return { done: Number(live?.done ?? 0), total: Number(live?.total ?? 0) };
        })();
  return { ...run, modJobs, progress };
};

export const vortexStagesRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{ Params: { id: string; stage: string }; Body: StageBody }>(
    '/api/vortex/groups/:id/stage/:stage',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid group id' });
      const stage = req.params.stage;
      if (!isServerVortexStage(stage) || !BUTTON_STAGES.includes(stage)) {
        return reply.code(400).send({ error: `Unknown stage: ${stage}` });
      }
      const group = await getVortexGroup(db, id);
      if (!group) return reply.code(404).send({ error: 'Group not found' });
      const active = await findActiveVortexRun(db, id);
      if (active) {
        return reply.code(409).send({
          error: `Run #${active.id} (${active.stage ?? active.current_stage ?? 'in progress'}) is still running`,
          runId: active.id,
        });
      }
      const needs = STAGE_NEEDS[stage];
      if (needs.length > 0) {
        const health = await probeKindsHealthy(needs);
        const missing = needs.find((kind) => !health[kind]);
        if (missing) {
          return reply.code(409).send({
            error: `No healthy ${SERVICE_LABEL[missing] ?? missing} endpoint — start the host, then retry`,
            service: missing,
          });
        }
      }
      const body = req.body ?? {};
      const channel = body.channel && isVortexChannel(body.channel) ? body.channel : 'all';
      const modIds = Array.isArray(body.modIds)
        ? body.modIds.filter((n) => Number.isInteger(n) && n > 0)
        : [];
      const { rows: latest } = await db.query<{ src_lang: string; tgt_lang: string }>(
        `SELECT src_lang, tgt_lang FROM vortex_sync_runs WHERE vortex_group_id = $1 ORDER BY id DESC LIMIT 1`,
        [id],
      );
      const run = await insertVortexSyncRun(db, {
        groupId: id,
        game: group.game as GameId,
        srcLang: latest[0]?.src_lang ?? 'en',
        tgtLang: latest[0]?.tgt_lang ?? 'uk',
        channel,
        stage,
        startedBy: body.startedBy === 'agent' ? 'agent' : 'ui',
        plan: {
          modIds,
          options: body.options ?? {},
          exportOrder: await getGroupExportOrder(db, id),
        },
      });
      const params = isFanOutStage(stage)
        ? { runId: run.id, stage, modIds, options: body.options ?? {} }
        : { runId: run.id, from: stage, to: stage };
      const jobId = await startBackgroundJob(
        { kind: 'vortex-sync', modId: null, params },
        { runId: run.id },
      );
      await db.query(`UPDATE vortex_sync_runs SET status = 'queued', job_id = $2 WHERE id = $1`, [
        run.id,
        jobId,
      ]);
      log.info(`Vortex stage ${stage} for group #${id}: run #${run.id} job #${jobId}`);
      return reply.code(201).send({ ok: true, runId: run.id, jobId, stage });
    },
  );

  app.post<{ Params: { runId: string } }>('/api/vortex/sync/:runId/stop', async (req, reply) => {
    const runId = parseRouteId(req.params.runId);
    if (runId === null) return reply.code(400).send({ error: 'Invalid run id' });
    const run = await getVortexSyncRun(db, runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    const stopped: number[] = [];
    for (const job of modJobsOf(run)) {
      if (job.status === 'running' && job.jobId != null && (await requestJobStop(job.jobId))) {
        stopped.push(job.jobId);
      }
    }
    if (run.job_id != null && (await requestJobStop(run.job_id))) stopped.push(run.job_id);
    return reply.send({ ok: true, stopped });
  });

  app.get<{ Params: { runId: string } }>('/api/vortex/sync/:runId', async (req, reply) => {
    const runId = parseRouteId(req.params.runId);
    if (runId === null) return reply.code(400).send({ error: 'Invalid run id' });
    const run = await getVortexSyncRun(db, runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return describeVortexRun(run);
  });
};

export { STAGE_JOB_KIND };
