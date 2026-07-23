import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import {
  commitVoiceRegenerateSession,
  discardVoiceRegenerateSession,
  generateVoiceRegeneratePreview,
  getVoiceRegeneratePreviewWav,
  initVoiceRegenerateSession,
  listVoiceRegenerateSession,
  type VoiceRegenerateParams,
} from '../../voice/voiceRegenerateService';

export const registerVoiceRegenerateRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:id/voice/regenerate/:formidLower6/:variant/session — start a preview session.
  app.post<{
    Params: { id: string; formidLower6: string; variant: string };
    Body: { sessionId?: string; srcLang?: string; targetLang?: string };
  }>('/api/mods/:id/voice/regenerate/:formidLower6/:variant/session', async (req, reply) => {
    const modId = Number(req.params.id);
    const formidLower6 = req.params.formidLower6.trim();
    const variant = Number.parseInt(req.params.variant, 10);
    const sessionId = req.body?.sessionId?.trim();
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
      return reply.code(400).send({ error: 'Invalid formid' });
    }
    if (!Number.isInteger(variant) || variant < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }
    if (!sessionId) {
      return reply.code(400).send({ error: 'sessionId is required' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const result = await initVoiceRegenerateSession(
      db,
      modId,
      sessionId,
      formidLower6,
      variant,
      srcLang,
      targetLang,
    );
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return reply.send(result);
  });

  // GET /api/mods/:id/voice/regenerate/:sessionId — list temporary previews in a session.
  app.get<{ Params: { id: string; sessionId: string } }>(
    '/api/mods/:id/voice/regenerate/:sessionId',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const sessionId = req.params.sessionId.trim();
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }

      const meta = listVoiceRegenerateSession(modId, sessionId);
      if (!meta) {
        return reply
          .code(404)
          .send({ ok: false, reason: 'session_missing', message: 'Session not found' });
      }

      return reply.send({
        ok: true,
        formidLower6: meta.formidLower6,
        variant: meta.variant,
        srcLang: meta.srcLang,
        targetLang: meta.targetLang,
        previews: meta.previews.map((preview) => ({
          id: preview.id,
          attempt: preview.attempt,
          createdAt: preview.createdAt,
          audioUrl: `/api/mods/${modId}/voice/regenerate/${sessionId}/${preview.id}.wav`,
          params: preview.params,
        })),
      });
    },
  );

  // POST /api/mods/:id/voice/regenerate/:sessionId/preview — synthesize one temporary preview.
  app.post<{
    Params: { id: string; sessionId: string };
    Body: {
      formidLower6?: string;
      variant?: number;
      srcLang?: string;
      targetLang?: string;
      params?: VoiceRegenerateParams;
    };
  }>('/api/mods/:id/voice/regenerate/:sessionId/preview', async (req, reply) => {
    const modId = Number(req.params.id);
    const sessionId = req.params.sessionId.trim();
    const formidLower6 = req.body?.formidLower6?.trim();
    const variant = req.body?.variant;
    const params = req.body?.params;
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!formidLower6 || !/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
      return reply.code(400).send({ error: 'Invalid formid' });
    }
    if (!Number.isInteger(variant) || variant! < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }
    if (!params) {
      return reply.code(400).send({ error: 'params are required' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const result = await generateVoiceRegeneratePreview(
      db,
      modId,
      sessionId,
      formidLower6,
      variant!,
      srcLang,
      targetLang,
      params,
    );
    if (!result.ok) {
      const status = result.reason === 'tts_failed' ? 503 : 400;
      return reply.code(status).send(result);
    }
    return reply.send(result);
  });

  // GET /api/mods/:id/voice/regenerate/:sessionId/:previewId.wav — stream a temporary preview WAV.
  app.get<{ Params: { id: string; sessionId: string; previewId: string } }>(
    '/api/mods/:id/voice/regenerate/:sessionId/:previewId.wav',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const sessionId = req.params.sessionId.trim();
      const previewId = req.params.previewId.replace(/\.wav$/i, '').trim();
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }

      const result = getVoiceRegeneratePreviewWav(modId, sessionId, previewId);
      if (!result.ok) {
        return reply.code(404).send(result);
      }
      return reply.type('audio/wav').send(fs.createReadStream(result.wavPath));
    },
  );

  // POST /api/mods/:id/voice/regenerate/:sessionId/commit — keep one preview and discard the session.
  app.post<{
    Params: { id: string; sessionId: string };
    Body: { previewId?: string };
  }>('/api/mods/:id/voice/regenerate/:sessionId/commit', async (req, reply) => {
    const modId = Number(req.params.id);
    const sessionId = req.params.sessionId.trim();
    const previewId = req.body?.previewId?.trim();
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!previewId) {
      return reply.code(400).send({ error: 'previewId is required' });
    }

    const result = await commitVoiceRegenerateSession(db, modId, sessionId, previewId);
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return reply.send(result);
  });

  // DELETE /api/mods/:id/voice/regenerate/:sessionId — discard a regeneration session.
  app.delete<{ Params: { id: string; sessionId: string } }>(
    '/api/mods/:id/voice/regenerate/:sessionId',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const sessionId = req.params.sessionId.trim();
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }

      discardVoiceRegenerateSession(modId, sessionId);
      return reply.send({ ok: true });
    },
  );
};
