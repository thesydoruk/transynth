/**
 * The jobs a mod's video goes through, and the phrases they produce.
 *
 *   POST /api/mods/:id/video/:videoId/separate   — separate + transcribe (409 while busy or
 *                                                  when audio-intel has no healthy host);
 *                                                  `keepPhrases` replaces the tracks only
 *   POST /api/mods/:id/video/:videoId/dub        — takes + mix (`scope`: all | changed |
 *                                                  segment:<idx>); a finished dub goes on
 *                                                  to `video-pack` by itself
 *   POST /api/mods/:id/video/:videoId/pack       — write the dub into the video again
 *                                                  (409 while busy, without a dub or the
 *                                                  file, or when no tools host is up)
 *   GET  /api/mods/:id/video/:videoId/segments   — the phrases with their translations
 *   GET  /api/video-separate/:jobId, POST …/stop — job status and stop
 *   GET  /api/video-dub/:jobId, GET /api/video-pack/:jobId
 */
import type { FastifyInstance } from 'fastify';
import { CONFIG } from '../../../config';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { probeKindsHealthy } from '../../../services/kindHealth';
import { readJobStatus, stopJobOfKind } from '../../../../worker/src/api/jobStatus';
import { startBackgroundJob } from '../../../../worker/src/api/startBackgroundJob';
import { videoFile } from '../../../video/audioStore';
import { getVideoAssetOfMod, setVideoAssetStatus } from '../../../video/db';
import { parseDubScope } from '../../../video/dub';
import { listVideoSegments } from '../../../video/segments';
import { parseRouteId } from '../parseRouteId';

/** audio-intel's two faces: the batch lane that separates and the ASR behind it. */
export const SEPARATE_NEEDS = ['separate', 'asr'] as const;

const BUSY_STATUSES = new Set(['separating', 'dubbing', 'packing']);

type VideoParams = { id: string; videoId: string };

const ids = (params: VideoParams): [number, number] | null => {
  const modId = parseRouteId(params.id);
  const videoId = parseRouteId(params.videoId);
  return modId === null || videoId === null ? null : [modId, videoId];
};

export const registerModVideoJobRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{
    Params: VideoParams;
    Body: { srcLang?: string; tgtLang?: string; keepPhrases?: boolean };
  }>('/api/mods/:id/video/:videoId/separate', async (req, reply) => {
    const pair = ids(req.params);
    if (!pair) return reply.code(400).send({ error: 'Invalid id' });
    const asset = await getVideoAssetOfMod(db, ...pair);
    if (!asset) return reply.code(404).send({ error: 'Not found' });
    if (!asset.audio_rel_path) {
      return reply.code(409).send({ error: 'The agent has not uploaded the video yet' });
    }
    if (BUSY_STATUSES.has(asset.status)) {
      return reply.code(409).send({ error: `Video is ${asset.status}` });
    }
    const health = await probeKindsHealthy(SEPARATE_NEEDS);
    const missing = SEPARATE_NEEDS.find((kind) => !health[kind]);
    if (missing) {
      return reply.code(409).send({ error: `No healthy ${missing} host`, missing });
    }
    const params = {
      videoId: asset.id,
      srcLang: req.body?.srcLang?.trim() || CONFIG.defaultSrcLang,
      tgtLang: req.body?.tgtLang?.trim() || CONFIG.defaultTgtLang,
      keepPhrases: req.body?.keepPhrases === true,
    };
    const jobId = await startBackgroundJob(
      { kind: 'video-separate', modId: asset.mod_id, params },
      { videoId: asset.id, stage: 'queued' },
    );
    await setVideoAssetStatus(db, asset.id, 'separating');
    log.info(
      `Video #${asset.id} ${asset.file_name}: separation job #${jobId}${params.keepPhrases ? ' (tracks only)' : ''}`,
    );
    return reply.send({ ok: true, jobId, videoId: asset.id });
  });

  app.post<{ Params: VideoParams; Body: { scope?: string; tgtLang?: string } }>(
    '/api/mods/:id/video/:videoId/dub',
    async (req, reply) => {
      const pair = ids(req.params);
      if (!pair) return reply.code(400).send({ error: 'Invalid id' });
      const scope = parseDubScope(req.body?.scope);
      if (!scope)
        return reply.code(400).send({ error: 'scope must be all, changed or segment:<idx>' });
      const asset = await getVideoAssetOfMod(db, ...pair);
      if (!asset) return reply.code(404).send({ error: 'Not found' });
      if (BUSY_STATUSES.has(asset.status)) {
        return reply.code(409).send({ error: `Video is ${asset.status}` });
      }
      if (asset.status === 'registered' || asset.status === 'uploaded') {
        return reply.code(409).send({ error: 'Separate the video before dubbing it' });
      }
      const health = await probeKindsHealthy(['tts']);
      if (!health.tts)
        return reply.code(409).send({ error: 'No healthy tts host', missing: 'tts' });
      const params = {
        videoId: asset.id,
        tgtLang: req.body?.tgtLang?.trim() || CONFIG.defaultTgtLang,
        scope: req.body?.scope ?? 'changed',
      };
      const jobId = await startBackgroundJob(
        { kind: 'video-dub', modId: asset.mod_id, params },
        { videoId: asset.id, stage: 'queued' },
      );
      await setVideoAssetStatus(db, asset.id, 'dubbing');
      log.info(`Video #${asset.id} ${asset.file_name}: dub job #${jobId} (${params.scope})`);
      return reply.send({ ok: true, jobId, videoId: asset.id });
    },
  );

  app.post<{ Params: VideoParams }>('/api/mods/:id/video/:videoId/pack', async (req, reply) => {
    const pair = ids(req.params);
    if (!pair) return reply.code(400).send({ error: 'Invalid id' });
    const asset = await getVideoAssetOfMod(db, ...pair);
    if (!asset) return reply.code(404).send({ error: 'Not found' });
    if (BUSY_STATUSES.has(asset.status)) {
      return reply.code(409).send({ error: `Video is ${asset.status}` });
    }
    if (!asset.dub_rel_path || !asset.dub_version) {
      return reply.code(409).send({ error: 'Dub the video before writing it' });
    }
    if (!videoFile(asset)) {
      return reply.code(409).send({ error: 'The video file is not on the server' });
    }
    const health = await probeKindsHealthy(['tools']);
    if (!health.tools) {
      return reply.code(409).send({ error: 'No healthy tools host', missing: 'tools' });
    }
    const jobId = await startBackgroundJob(
      { kind: 'video-pack', modId: asset.mod_id, params: { videoId: asset.id } },
      { videoId: asset.id, stage: 'queued' },
    );
    await setVideoAssetStatus(db, asset.id, 'packing');
    log.info(`Video #${asset.id} ${asset.file_name}: pack job #${jobId}`);
    return reply.send({ ok: true, jobId, videoId: asset.id });
  });

  app.get<{ Params: VideoParams; Querystring: { tgtLang?: string } }>(
    '/api/mods/:id/video/:videoId/segments',
    async (req, reply) => {
      const pair = ids(req.params);
      if (!pair) return reply.code(400).send({ error: 'Invalid id' });
      const asset = await getVideoAssetOfMod(db, ...pair);
      if (!asset) return reply.code(404).send({ error: 'Not found' });
      const tgtLang = req.query.tgtLang?.trim() || CONFIG.defaultTgtLang;
      return { segments: await listVideoSegments(db, asset.id, tgtLang) };
    },
  );

  for (const [kind, label] of [
    ['video-separate', 'separation'],
    ['video-dub', 'dub'],
    ['video-pack', 'pack'],
  ] as const) {
    app.get<{ Params: { jobId: string } }>(`/api/${kind}/:jobId`, async (req, reply) => {
      const jobId = parseRouteId(req.params.jobId);
      if (jobId === null) return reply.code(400).send({ error: 'Invalid jobId' });
      const status = await readJobStatus(jobId, [kind]);
      if (!status) return reply.code(404).send({ error: 'Job not found' });
      return status;
    });
    app.post<{ Params: { jobId: string } }>(`/api/${kind}/:jobId/stop`, async (req, reply) => {
      const jobId = parseRouteId(req.params.jobId);
      if (jobId === null) return reply.code(400).send({ error: 'Invalid jobId' });
      if (!(await stopJobOfKind(jobId, [kind]))) {
        return reply.code(404).send({ error: `Running ${label} job not found` });
      }
      return reply.send({ ok: true });
    });
  }
};
