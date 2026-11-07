/**
 * A mod's cutscene videos.
 *
 *   GET  /api/mods/:id/video                        — the mod's videos with their state,
 *                                                     and which hosts the stages need are up
 *   GET  /api/mods/:id/video/:videoId               — one video
 *   PUT  /api/mods/:id/video/:videoId/file          — the agent uploads the video itself
 *                                                     (token); the server reads the tracks
 *                                                     and decodes the narration
 *   GET  /api/mods/:id/video/:videoId/audio/:kind   — source | speech | background | dub as
 *                                                     audio/wav; `?from=&to=` plays a slice
 *   GET  /api/mods/:id/video/phrase/:stringId       — the video and timing behind one VIDEO
 *                                                     record, for the editor's phrase player
 */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { probeKindsHealthy } from '../../../services/kindHealth';
import { startBackgroundJob } from '../../../../worker/src/api/startBackgroundJob';
import { sliceWavToTemp, storeVideoFile, videoAudioFile } from '../../../video/audioStore';
import { getVideoAssetOfMod, listVideoAssets } from '../../../video/db';
import { ingestVideoFile } from '../../../video/ingest';
import { ensureVideoSchema } from '../../../video/schema';
import { VIDEO_AUDIO_KINDS, type VideoAudioKind } from '../../../video/types';
import { VIDEO_SIGNATURE } from '../../../video/videoRecords';
import { parseRouteId } from '../parseRouteId';

/** The hosts the media tab shows a light for: separation, ASR, TTS, the Bink mixer. */
const VIDEO_SERVICE_KINDS = ['separate', 'asr', 'tts', 'tools'] as const;

const ids = (params: { id: string; videoId: string }): [number, number] | null => {
  const modId = parseRouteId(params.id);
  const videoId = parseRouteId(params.videoId);
  return modId === null || videoId === null ? null : [modId, videoId];
};

export const registerModVideoRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureVideoSchema(db);

  app.get<{ Params: { id: string } }>('/api/mods/:id/video', async (req, reply) => {
    const modId = parseRouteId(req.params.id);
    if (modId === null) return reply.code(400).send({ error: 'Invalid mod id' });
    const [assets, services] = await Promise.all([
      listVideoAssets(db, modId),
      probeKindsHealthy(VIDEO_SERVICE_KINDS),
    ]);
    return { assets, services };
  });

  app.get<{ Params: { id: string; stringId: string } }>(
    '/api/mods/:id/video/phrase/:stringId',
    async (req, reply) => {
      const modId = parseRouteId(req.params.id);
      const stringId = parseRouteId(req.params.stringId);
      if (modId === null || stringId === null) {
        return reply.code(400).send({ error: 'Invalid id' });
      }
      const { rows } = await db.query<{
        video_id: number;
        idx: number;
        start_s: number;
        end_s: number;
        next_start_s: number | null;
        duration_s: number | null;
        has_speech: boolean;
        has_dub: boolean;
        take_similarity: number | null;
        tempo: number | null;
        overrun: boolean;
      }>(
        `SELECT v.video_id, v.idx, v.start_s, v.end_s,
                (SELECT MIN(n.start_s) FROM video_segments n
                  WHERE n.video_id = v.video_id AND n.idx > v.idx) AS next_start_s,
                a.duration_s,
                a.status NOT IN ('registered', 'uploaded', 'separating') AS has_speech,
                a.dub_rel_path IS NOT NULL AS has_dub,
                v.take_similarity, v.tempo, v.overrun
           FROM video_segments v
           JOIN video_assets a ON a.id = v.video_id
           JOIN strings s ON s.id = v.string_id
           JOIN records r ON r.id = s.record_id
          WHERE v.string_id = $1 AND a.mod_id = $2 AND r.signature = $3`,
        [stringId, modId, VIDEO_SIGNATURE],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Not a video phrase' });
      const row = rows[0];
      return {
        videoId: row.video_id,
        idx: row.idx,
        startS: row.start_s,
        endS: row.end_s,
        nextStartS: row.next_start_s,
        durationS: row.duration_s,
        hasSpeech: row.has_speech,
        hasDub: row.has_dub,
        takeSimilarity: row.take_similarity,
        tempo: row.tempo,
        overrun: row.overrun,
      };
    },
  );

  app.get<{ Params: { id: string; videoId: string } }>(
    '/api/mods/:id/video/:videoId',
    async (req, reply) => {
      const pair = ids(req.params);
      if (!pair) return reply.code(400).send({ error: 'Invalid id' });
      const asset = await getVideoAssetOfMod(db, ...pair);
      if (!asset) return reply.code(404).send({ error: 'Not found' });
      return { asset };
    },
  );

  app.put<{ Params: { id: string; videoId: string } }>(
    '/api/mods/:id/video/:videoId/file',
    async (req, reply) => {
      const pair = ids(req.params);
      if (!pair) return reply.code(400).send({ error: 'Invalid id' });
      const asset = await getVideoAssetOfMod(db, ...pair);
      if (!asset) return reply.code(404).send({ error: 'Not found' });
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });
      let stored: { relPath: string; bytes: number };
      try {
        stored = await storeVideoFile(asset, data.file);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Video #${asset.id} ${asset.file_name}: upload refused: ${message}`);
        return reply.code(400).send({ error: message });
      }
      const outcome = await ingestVideoFile(db, asset);
      let packJobId: number | null = null;
      if (outcome.needsPack) {
        packJobId = await startBackgroundJob(
          { kind: 'video-pack', modId: asset.mod_id, params: { videoId: asset.id } },
          { videoId: asset.id, stage: 'queued' },
        );
      }
      log.info(`Video #${asset.id} ${asset.file_name}: file ${stored.bytes} bytes`);
      return reply.send({ ok: true, bytes: stored.bytes, ...outcome, packJobId });
    },
  );

  app.get<{
    Params: { id: string; videoId: string; kind: string };
    Querystring: { from?: string; to?: string };
  }>('/api/mods/:id/video/:videoId/audio/:kind', async (req, reply) => {
    const pair = ids(req.params);
    if (!pair) return reply.code(400).send({ error: 'Invalid id' });
    const kind = req.params.kind as VideoAudioKind;
    if (!VIDEO_AUDIO_KINDS.includes(kind)) return reply.code(400).send({ error: 'Invalid kind' });
    const asset = await getVideoAssetOfMod(db, ...pair);
    if (!asset) return reply.code(404).send({ error: 'Not found' });
    const file = videoAudioFile(asset, kind);
    if (!file) return reply.code(404).send({ error: `No ${kind} audio yet` });

    // `?from=&to=` plays one phrase: the slice is cut to a temp file and removed after.
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    const slice = req.query.from != null || req.query.to != null;
    if (slice && !(Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from)) {
      return reply.code(400).send({ error: 'from and to must be seconds with from < to' });
    }
    const toSend = slice ? await sliceWavToTemp(file, from, to) : file;
    const stream = fs.createReadStream(toSend);
    if (slice) stream.on('close', () => fs.rmSync(toSend, { force: true }));
    return reply
      .header('Content-Type', 'audio/wav')
      .header('Content-Length', String(fs.statSync(toSend).size))
      .header('Content-Disposition', `inline; filename="${kind}.wav"`)
      .send(stream);
  });
};
