import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import { PATHS } from '../../paths';
import { ensureDir } from '../../utils/file';
import { getExportArchive } from '../data/queries';
import { resolveExportArchiveFile } from '../export/exportArchiveFiles';
import { startBackgroundJob } from '../../../worker/src/api/startBackgroundJob';
import {
  getOrCreateVortexGroup,
  getVortexGroup,
  getLatestVortexSyncRun,
  getVortexGroupByKey,
  getVortexSyncRun,
  insertVortexSyncRun,
  listCurrentGroupModIds,
  listGameReleases,
  listVortexGroups,
  planVortexUnits,
  updateVortexSyncRun,
} from '../../vortex/db';
import { ensureVortexSchema } from '../../vortex/schema';
import { registerVortexPack, vortexExtractDir } from '../../vortex/registerPack';
import { scopedVortexFileHash, vortexGroupLabel } from '../../vortex/groupKey';
import {
  isVortexChannel,
  resolveStageRange,
  vortexRangeCrossesTm,
  vortexWorkerStages,
  type ServerVortexStage,
} from '../../vortex/stages';
import { isVortexExportOrder } from '../../vortex/exportOrder';
import type { VortexExportOrder, VortexPlanPayload } from '../../vortex/types';
import type { GameType } from '../../types';

const requireCliToken = async (
  req: { headers: { authorization?: string } },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> => {
  if (!CONFIG.cliToken) return true;
  const expected = `Bearer ${CONFIG.cliToken}`;
  if (req.headers.authorization !== expected) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

export const vortexSyncRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureVortexSchema(db);

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/vortex')) return;
    if (req.method === 'GET' || req.method === 'HEAD') return;
    await requireCliToken(req, reply);
  });

  app.get('/api/vortex/groups', async (req) => {
    const game = (req.query as { game?: string }).game;
    return { groups: await listVortexGroups(db, game) };
  });

  app.get('/api/vortex/groups/by-key', async (req, reply) => {
    const query = req.query as { game?: string; key?: string };
    if (!query.game || !query.key) {
      return reply.code(400).send({ error: 'game and key are required' });
    }
    const group = await getVortexGroupByKey(db, query.game, query.key);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    return { group };
  });

  app.get<{ Params: { id: string } }>('/api/vortex/groups/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const group = await getVortexGroup(db, id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    const releases = await listGameReleases(db, id);
    return { group, releases };
  });

  app.get<{ Params: { id: string } }>('/api/vortex/groups/:id/mods', async (req, reply) => {
    const id = Number(req.params.id);
    const group = await getVortexGroup(db, id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    const channelRaw = (req.query as { channel?: string }).channel ?? 'all';
    const channel = isVortexChannel(channelRaw) ? channelRaw : 'all';
    const ids = await listCurrentGroupModIds(db, id, channel);
    if (ids.length === 0) return { mods: [] };
    const { rows } = await db.query<{ id: number; name: string }>(
      `SELECT id, name FROM mods WHERE id = ANY($1::int[]) ORDER BY name`,
      [ids],
    );
    return { mods: rows };
  });

  app.get<{ Params: { id: string } }>('/api/vortex/groups/:id/latest-run', async (req, reply) => {
    const id = Number(req.params.id);
    const group = await getVortexGroup(db, id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    const run = await getLatestVortexSyncRun(db, id);
    return { run: run ?? null };
  });

  app.post<{ Body: VortexPlanPayload }>('/api/vortex/sync/plan', async (req, reply) => {
    const body = req.body;
    if (!body?.groupKey || !body.game || !Array.isArray(body.units)) {
      return reply.code(400).send({ error: 'groupKey, game and units are required' });
    }
    const channel = isVortexChannel(body.channel) ? body.channel : 'all';
    const game = body.game as GameType;
    const group = await getOrCreateVortexGroup(db, {
      game,
      groupKey: body.groupKey,
      label: body.label || vortexGroupLabel(body.stagingPath || body.groupKey, game),
      stagingPath: body.stagingPath,
      gameDir: body.gameDir,
    });
    const units = await planVortexUnits(db, group.id, { ...body, channel, game });
    const run = await insertVortexSyncRun(db, {
      groupId: group.id,
      game,
      srcLang: body.srcLang || CONFIG.defaultSrcLang,
      tgtLang: body.tgtLang || CONFIG.defaultTgtLang,
      channel,
      plan: { ...body, units, gameRelease: body.gameRelease },
    });
    log.info(`Vortex plan run=${run.id} group=${group.id} units=${units.length}`);
    return reply.code(201).send({ run, group, units });
  });

  app.put<{ Params: { runId: string; unitId: string } }>(
    '/api/vortex/sync/:runId/packs/:unitId',
    async (req, reply) => {
      const runId = Number(req.params.runId);
      const run = await getVortexSyncRun(db, runId);
      if (!run) return reply.code(404).send({ error: 'Run not found' });
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });

      const plan = run.plan_json as { units?: Array<Record<string, unknown>> };
      const unit = (plan.units ?? []).find((row) => row.unitId === req.params.unitId);
      if (!unit) return reply.code(404).send({ error: 'Unit not in plan' });

      const contentHash = String(unit.contentHash ?? '');
      const scoped = scopedVortexFileHash(run.vortex_group_id, contentHash);
      const groupRoot = path.join(PATHS.vortexUploads, String(run.vortex_group_id));
      ensureDir(groupRoot);
      const zipPath = path.join(groupRoot, `${scoped.replace(/[:\\/]+/g, '_')}.zip`);
      await pipeline(data.file, fs.createWriteStream(zipPath));

      const job = await registerVortexPack(db, {
        groupId: run.vortex_group_id,
        fileName: data.filename || `${String(unit.name)}.zip`,
        zipPath,
        extractDir: vortexExtractDir(groupRoot, scoped),
        contentHash,
        srcLang: run.src_lang,
        tgtLang: run.tgt_lang,
        game: run.game as GameType,
        nexusModId: typeof unit.nexusModId === 'number' ? unit.nexusModId : null,
        nexusModName: typeof unit.nexusModName === 'string' ? unit.nexusModName : null,
        sourceFolder: typeof unit.sourceFolder === 'string' ? unit.sourceFolder : null,
      });

      const units = (plan.units ?? []).map((row) =>
        row.unitId === req.params.unitId
          ? { ...row, existingJobId: job.id, existingModId: job.mod_id }
          : row,
      );
      await updateVortexSyncRun(db, run.id, { plan_json: { ...plan, units } });
      return reply.send({ job, unitId: req.params.unitId });
    },
  );

  app.post<{
    Params: { runId: string };
    Body: { from?: string; to?: string; exportOrder?: VortexExportOrder };
  }>('/api/vortex/sync/:runId/start', async (req, reply) => {
    const runId = Number(req.params.runId);
    const run = await getVortexSyncRun(db, runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (req.body?.exportOrder !== undefined && !isVortexExportOrder(req.body.exportOrder)) {
      return reply.code(400).send({ error: 'exportOrder is invalid' });
    }
    if (isVortexExportOrder(req.body?.exportOrder)) {
      const plan =
        run.plan_json && typeof run.plan_json === 'object'
          ? (run.plan_json as Record<string, unknown>)
          : {};
      await updateVortexSyncRun(db, run.id, {
        plan_json: { ...plan, exportOrder: req.body.exportOrder },
      });
    }
    const requested = resolveStageRange(req.body?.from, req.body?.to);
    if (vortexRangeCrossesTm(requested)) {
      return reply.code(400).send({
        error:
          'TM is a tm-apply job, not vortex-sync. Start import–carry and llm–export separately.',
      });
    }
    const stages = vortexWorkerStages(requested);
    if (stages.length === 0) {
      return reply.send({ ok: true, runId, skipped: true, reason: 'no server stages' });
    }
    const from = stages[0]! as ServerVortexStage;
    const to = stages[stages.length - 1]! as ServerVortexStage;
    const jobId = await startBackgroundJob(
      { kind: 'vortex-sync', modId: null, params: { runId, from, to } },
      { runId },
    );
    await updateVortexSyncRun(db, runId, { status: 'queued', job_id: jobId });
    return reply.send({ ok: true, runId, jobId, from, to });
  });

  app.get<{ Params: { runId: string } }>('/api/vortex/sync/:runId', async (req, reply) => {
    const run = await getVortexSyncRun(db, Number(req.params.runId));
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return run;
  });

  app.get<{ Params: { runId: string } }>('/api/vortex/sync/:runId/langpack', async (req, reply) => {
    const run = await getVortexSyncRun(db, Number(req.params.runId));
    if (!run?.export_archive_id) return reply.code(404).send({ error: 'Langpack not ready' });
    const archive = await getExportArchive(db, run.export_archive_id);
    if (!archive || archive.status !== 'completed' || !archive.rel_path) {
      return reply.code(409).send({ error: 'Langpack is not ready' });
    }
    const filePath = resolveExportArchiveFile(archive.rel_path);
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Archive file is missing' });
    }
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${archive.file_name}"`)
      .send(fs.createReadStream(filePath));
  });
};
