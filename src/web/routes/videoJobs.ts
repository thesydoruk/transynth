/**
 * The jobs a video goes through, and the phrases they produce.
 *
 *   POST /api/video/:game/:id/separate       — separate + transcribe (409 while busy or
 *                                              when audio-intel has no healthy host)
 *   GET  /api/video-separate/:jobId           — job status
 *   POST /api/video-separate/:jobId/stop
 *   GET  /api/video/:game/:id/segments        — the phrases with their translations
 */
import type { FastifyInstance } from 'fastify';
import { CONFIG } from '../../config';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { probeKindsHealthy } from '../../services/kindHealth';
import { readJobStatus, stopJobOfKind } from '../../../worker/src/api/jobStatus';
import { startBackgroundJob } from '../../../worker/src/api/startBackgroundJob';
import { getVideoAsset, setVideoAssetStatus } from '../../video/db';
import { listVideoSegments } from '../../video/segments';
import { parseRouteId } from './parseRouteId';

/** audio-intel's two faces: the batch lane that separates and the ASR behind it. */
export const SEPARATE_NEEDS = ['separate', 'asr'] as const;

const BUSY_STATUSES = new Set(['separating', 'dubbing']);

export const videoJobRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{ Params: { game: string; id: string }; Body: { srcLang?: string; tgtLang?: string } }>(
    '/api/video/:game/:id/separate',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid video id' });
      const asset = await getVideoAsset(db, id);
      if (!asset || asset.game !== req.params.game) {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (!asset.audio_rel_path) {
        return reply.code(409).send({ error: 'The agent has not uploaded the audio yet' });
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
      };
      const jobId = await startBackgroundJob(
        { kind: 'video-separate', modId: null, params },
        { videoId: asset.id, stage: 'queued' },
      );
      await setVideoAssetStatus(db, asset.id, 'separating');
      log.info(`Video #${asset.id} ${asset.file_name}: separation job #${jobId}`);
      return reply.send({ ok: true, jobId, videoId: asset.id });
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/video-separate/:jobId', async (req, reply) => {
    const jobId = parseRouteId(req.params.jobId);
    if (jobId === null) return reply.code(400).send({ error: 'Invalid jobId' });
    const status = await readJobStatus(jobId, ['video-separate']);
    if (!status) return reply.code(404).send({ error: 'Job not found' });
    return status;
  });

  app.post<{ Params: { jobId: string } }>('/api/video-separate/:jobId/stop', async (req, reply) => {
    const jobId = parseRouteId(req.params.jobId);
    if (jobId === null) return reply.code(400).send({ error: 'Invalid jobId' });
    if (!(await stopJobOfKind(jobId, ['video-separate']))) {
      return reply.code(404).send({ error: 'Running separation job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { game: string; id: string }; Querystring: { tgtLang?: string } }>(
    '/api/video/:game/:id/segments',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid video id' });
      const asset = await getVideoAsset(db, id);
      if (!asset || asset.game !== req.params.game) {
        return reply.code(404).send({ error: 'Not found' });
      }
      const tgtLang = req.query.tgtLang?.trim() || CONFIG.defaultTgtLang;
      return { segments: await listVideoSegments(db, asset.id, tgtLang) };
    },
  );
};
