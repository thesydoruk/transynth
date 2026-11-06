/**
 * Cutscene videos of a game.
 *
 *   GET  /api/video/:game                   — every video the agent registered, with its state
 *   POST /api/video/:game/assets            — the agent registers (or re-registers) a video (token)
 *   PUT  /api/video/:game/:id/audio         — the agent uploads the source track as WAV (token)
 *   GET  /api/video/:game/:id               — one video
 *   GET  /api/video/:game/:id/audio/:kind   — source | speech | background | dub as audio/wav
 *   POST /api/video/:game/:id/packed        — the agent wrote this dub version into the video (token)
 */
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { allGamePlugins } from '../../games/registry';
import { log } from '../../logger';
import type { GameId } from '../../types';
import { probeKindsHealthy } from '../../services/kindHealth';
import { sliceWavToTemp, storeVideoSourceAudio, videoAudioFile } from '../../video/audioStore';
import {
  getVideoAsset,
  listVideoAssets,
  registerVideoAsset,
  setVideoAssetAudio,
  setVideoAssetPacked,
} from '../../video/db';
import { ensureVideoSchema } from '../../video/schema';
import {
  VIDEO_AUDIO_KINDS,
  type VideoAssetRegistration,
  type VideoAudioKind,
} from '../../video/types';
import { parseRouteId } from './parseRouteId';

/** The hosts the Video page shows a light for: separation, ASR, TTS. */
const VIDEO_SERVICE_KINDS = ['separate', 'asr', 'tts'] as const;

const isMediaGame = (value: unknown): value is GameId =>
  typeof value === 'string' && allGamePlugins().some((p) => p.id === value && p.media);

/** The registration body, or the reason it is not one. */
export const parseVideoRegistration = (
  body: unknown,
): { ok: true; reg: VideoAssetRegistration } | { ok: false; error: string } => {
  const b = (body ?? {}) as Record<string, unknown>;
  const fileName = typeof b.fileName === 'string' ? b.fileName.trim() : '';
  if (!fileName || /[\\/]/.test(fileName)) {
    return { ok: false, error: 'fileName must be a bare file name' };
  }
  if (typeof b.fingerprint !== 'string' || !b.fingerprint) {
    return { ok: false, error: 'fingerprint is required' };
  }
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const trackIds = Array.isArray(b.trackIds)
    ? b.trackIds.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0)
    : [];
  return {
    ok: true,
    reg: {
      fileName,
      byteSize: num(b.byteSize) ?? 0,
      fingerprint: b.fingerprint,
      durationS: num(b.durationS),
      trackIds,
      sourceTrackId: num(b.sourceTrackId),
      agentKey: typeof b.agentKey === 'string' ? b.agentKey : null,
    },
  };
};

export const videoRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureVideoSchema(db);

  app.get<{ Params: { game: string } }>('/api/video/:game', async (req, reply) => {
    if (!isMediaGame(req.params.game)) return reply.code(404).send({ error: 'No videos' });
    const [assets, services] = await Promise.all([
      listVideoAssets(db, req.params.game),
      probeKindsHealthy(VIDEO_SERVICE_KINDS),
    ]);
    return { assets, services };
  });

  app.post<{ Params: { game: string } }>('/api/video/:game/assets', async (req, reply) => {
    if (!isMediaGame(req.params.game)) return reply.code(404).send({ error: 'No videos' });
    const parsed = parseVideoRegistration(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const asset = await registerVideoAsset(db, req.params.game, parsed.reg);
    log.info(`Video ${asset.game}/${asset.file_name} registered as #${asset.id} (${asset.status})`);
    return reply.code(201).send({ asset });
  });

  app.get<{ Params: { game: string; id: string } }>('/api/video/:game/:id', async (req, reply) => {
    const id = parseRouteId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Invalid video id' });
    const asset = await getVideoAsset(db, id);
    if (!asset || asset.game !== req.params.game) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { asset };
  });

  app.put<{ Params: { game: string; id: string } }>(
    '/api/video/:game/:id/audio',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid video id' });
      const asset = await getVideoAsset(db, id);
      if (!asset || asset.game !== req.params.game) {
        return reply.code(404).send({ error: 'Not found' });
      }
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });
      const stored = await storeVideoSourceAudio(asset, data.file);
      await setVideoAssetAudio(db, asset.id, stored.relPath);
      log.info(`Video #${asset.id} ${asset.file_name}: source audio ${stored.bytes} bytes`);
      return reply.send({ ok: true, bytes: stored.bytes });
    },
  );

  app.post<{ Params: { game: string; id: string }; Body: { dubVersion?: string } }>(
    '/api/video/:game/:id/packed',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid video id' });
      const dubVersion = typeof req.body?.dubVersion === 'string' ? req.body.dubVersion : '';
      if (!dubVersion) return reply.code(400).send({ error: 'dubVersion is required' });
      const asset = await getVideoAsset(db, id);
      if (!asset || asset.game !== req.params.game) {
        return reply.code(404).send({ error: 'Not found' });
      }
      await setVideoAssetPacked(db, asset.id, dubVersion);
      log.info(
        `Video #${asset.id} ${asset.file_name}: dub ${dubVersion.slice(0, 12)} written by the agent`,
      );
      return reply.send({ ok: true, current: asset.dub_version === dubVersion });
    },
  );

  app.get<{
    Params: { game: string; id: string; kind: string };
    Querystring: { from?: string; to?: string };
  }>('/api/video/:game/:id/audio/:kind', async (req, reply) => {
    const id = parseRouteId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Invalid video id' });
    const kind = req.params.kind as VideoAudioKind;
    if (!VIDEO_AUDIO_KINDS.includes(kind)) return reply.code(400).send({ error: 'Invalid kind' });
    const asset = await getVideoAsset(db, id);
    if (!asset || asset.game !== req.params.game) {
      return reply.code(404).send({ error: 'Not found' });
    }
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
