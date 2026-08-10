import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import {
  clearVoiceSpeakerReferenceForMod,
  generateVoiceTranslationForMod,
  getVoicePreviewWav,
  getVoiceTranslationWav,
  invalidateVoiceListContext,
  listVoiceAvailabilityForMod,
  listVoiceLinesForSpeaker,
  listVoiceSpeakersForMod,
  setVoiceSpeakerReferenceForMod,
} from '../../voice/preview';
import { saveStressedTranslation } from '../../data/queries/stressPlacement';

export const registerVoiceRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/mods/:id/voice/lines — speakers (default) or one speaker's lines.
  app.get<{
    Params: { id: string };
    Querystring: { srcLang?: string; targetLang?: string; speakerKey?: string };
  }>('/api/mods/:id/voice/lines', async (req, reply) => {
    const modId = Number(req.params.id);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }

    const srcLang = req.query.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang?.trim() || CONFIG.defaultTgtLang;
    const speakerKey = req.query.speakerKey?.trim();

    if (speakerKey) {
      const result = await listVoiceLinesForSpeaker(db, modId, speakerKey, srcLang, targetLang);
      if (!result.ok) {
        const status =
          result.reason === 'mod_not_found' || result.reason === 'speaker_not_found'
            ? 404
            : result.reason === 'no_voice_files'
              ? 404
              : 400;
        return reply.code(status).send(result);
      }
      return reply.send(result);
    }

    const result = await listVoiceSpeakersForMod(db, modId, srcLang, targetLang);
    if (!result.ok) {
      const status =
        result.reason === 'mod_not_found' ? 404 : result.reason === 'no_voice_files' ? 404 : 400;
      return reply.code(status).send(result);
    }
    return reply.send(result);
  });

  // GET /api/mods/:id/voice/availability — which lines have audio, without the metadata.
  app.get<{
    Params: { id: string };
    Querystring: { targetLang?: string };
  }>('/api/mods/:id/voice/availability', async (req, reply) => {
    const modId = Number(req.params.id);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }

    const result = await listVoiceAvailabilityForMod(db, modId, req.query.targetLang?.trim());
    if (!result.ok) {
      return reply.code(result.reason === 'mod_not_found' ? 404 : 400).send(result);
    }
    return reply.send(result);
  });

  // GET /api/mods/:id/voice/audio/:formidLower6/:variant — stream cached preview WAV.
  app.get<{ Params: { id: string; formidLower6: string; variant: string } }>(
    '/api/mods/:id/voice/audio/:formidLower6/:variant',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const formidLower6 = req.params.formidLower6.trim();
      const variant = Number.parseInt(req.params.variant, 10);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }
      if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
        return reply.code(400).send({ error: 'Invalid formid' });
      }
      if (!Number.isInteger(variant) || variant < 1) {
        return reply.code(400).send({ error: 'Invalid variant' });
      }

      const result = await getVoicePreviewWav(db, modId, formidLower6, variant);
      if (!result.ok) {
        const status =
          result.reason === 'mod_not_found' || result.reason === 'line_not_found'
            ? 404
            : result.reason === 'convert_failed'
              ? 503
              : 400;
        return reply.code(status).send(result);
      }

      return reply.type('audio/wav').send(fs.createReadStream(result.wavPath));
    },
  );

  // GET /api/mods/:id/voice/translation-audio/:formidLower6/:variant — stream synthesized TTS WAV.
  app.get<{ Params: { id: string; formidLower6: string; variant: string } }>(
    '/api/mods/:id/voice/translation-audio/:formidLower6/:variant',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const formidLower6 = req.params.formidLower6.trim();
      const variant = Number.parseInt(req.params.variant, 10);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }
      if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
        return reply.code(400).send({ error: 'Invalid formid' });
      }
      if (!Number.isInteger(variant) || variant < 1) {
        return reply.code(400).send({ error: 'Invalid variant' });
      }

      const result = await getVoiceTranslationWav(db, modId, formidLower6, variant);
      if (!result.ok) {
        const status =
          result.reason === 'mod_not_found' || result.reason === 'line_not_found'
            ? 404
            : result.reason === 'translation_not_generated'
              ? 404
              : 400;
        return reply.code(status).send(result);
      }

      return reply.type('audio/wav').send(fs.createReadStream(result.wavPath));
    },
  );

  // POST /api/mods/:id/voice/translation-audio/:formidLower6/:variant — synthesize one line.
  app.post<{
    Params: { id: string; formidLower6: string; variant: string };
    Querystring: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:id/voice/translation-audio/:formidLower6/:variant', async (req, reply) => {
    const modId = Number(req.params.id);
    const formidLower6 = req.params.formidLower6.trim();
    const variant = Number.parseInt(req.params.variant, 10);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
      return reply.code(400).send({ error: 'Invalid formid' });
    }
    if (!Number.isInteger(variant) || variant < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }

    const srcLang = req.query.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang?.trim() || CONFIG.defaultTgtLang;
    const result = await generateVoiceTranslationForMod(
      db,
      modId,
      formidLower6,
      variant,
      srcLang,
      targetLang,
    );
    if (!result.ok) {
      const status =
        result.reason === 'mod_not_found' || result.reason === 'line_not_found'
          ? 404
          : result.reason === 'tts_failed'
            ? 503
            : 400;
      return reply.code(status).send(result);
    }
    invalidateVoiceListContext(modId);
    return reply.send(result);
  });

  // PUT /api/mods/:id/voice/speaker-ref — set TTS reference line for one speaker.
  app.put<{
    Params: { id: string };
    Querystring: { srcLang?: string; targetLang?: string };
    Body: { speakerKey?: string; formidLower6?: string; variant?: number };
  }>('/api/mods/:id/voice/speaker-ref', async (req, reply) => {
    const modId = Number(req.params.id);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }

    const speakerKey = req.body?.speakerKey?.trim() ?? '';
    const formidLower6 = req.body?.formidLower6?.trim() ?? '';
    const variant = Number(req.body?.variant);
    if (!speakerKey) return reply.code(400).send({ error: 'speakerKey is required' });
    if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
      return reply.code(400).send({ error: 'Invalid formidLower6' });
    }
    if (!Number.isInteger(variant) || variant < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }

    const result = await setVoiceSpeakerReferenceForMod(
      db,
      modId,
      speakerKey,
      formidLower6,
      variant,
      req.query.srcLang?.trim() || CONFIG.defaultSrcLang,
      req.query.targetLang?.trim() || CONFIG.defaultTgtLang,
    );
    if (!result.ok) {
      const status =
        result.reason === 'mod_not_found' || result.reason === 'line_not_found'
          ? 404
          : result.reason === 'line_not_in_speaker'
            ? 400
            : 400;
      return reply.code(status).send(result);
    }
    invalidateVoiceListContext(modId);
    return reply.send(result);
  });

  // PUT /api/mods/:id/voice/stressed/:translationId — save manual stress marks (voice page only).
  app.put<{
    Params: { id: string; translationId: string };
    Body: { textStressed?: string };
  }>('/api/mods/:id/voice/stressed/:translationId', async (req, reply) => {
    const modId = Number(req.params.id);
    const translationId = Number(req.params.translationId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!Number.isInteger(translationId) || translationId < 1) {
      return reply.code(400).send({ error: 'Invalid translation id' });
    }

    const { rows } = await db.query<{ id: number }>(
      `SELECT t.id
         FROM translations t
         JOIN strings s ON s.id = t.src_string_id
         JOIN records r ON r.id = s.record_id
        WHERE t.id = $1 AND r.mod_id = $2`,
      [translationId, modId],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Translation not found' });

    try {
      const result = await saveStressedTranslation(db, translationId, req.body?.textStressed ?? '');
      invalidateVoiceListContext(modId);
      return reply.send({ ok: true, textStressed: result.textStressed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Stressed text must match')) {
        return reply.code(400).send({ error: message });
      }
      throw err;
    }
  });

  // DELETE /api/mods/:id/voice/speaker-ref/:speakerKey — clear saved TTS reference.
  app.delete<{ Params: { id: string; speakerKey: string } }>(
    '/api/mods/:id/voice/speaker-ref/:speakerKey',
    async (req, reply) => {
      const modId = Number(req.params.id);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }

      const speakerKey = decodeURIComponent(req.params.speakerKey).trim();
      const result = await clearVoiceSpeakerReferenceForMod(db, modId, speakerKey);
      if (!result.ok) {
        const status = result.reason === 'mod_not_found' ? 404 : 400;
        return reply.code(status).send(result);
      }
      invalidateVoiceListContext(modId);
      return reply.send(result);
    },
  );
};
