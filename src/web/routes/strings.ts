import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listStrings, listSignatures, upsertTranslation, updateTranslationStatus } from '../queries.js';
import { chatWithFallback } from '../../llm/index.js';
import { CONFIG } from '../../config.js';
import { log } from '../../logger.js';

export async function stringsRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/strings?modId=&status=&signature=&q=&page=&pageSize=
  app.get<{
    Querystring: {
      modId?: string;
      status?: string;
      signature?: string;
      q?: string;
      page?: string;
      pageSize?: string;
    };
  }>('/api/strings', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const result = listStrings(db, {
      modId,
      status: req.query.status,
      query: req.query.q,
      signature: req.query.signature,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });

    return reply.send(result);
  });

  // GET /api/strings/signatures?modId=
  app.get<{ Querystring: { modId?: string } }>('/api/strings/signatures', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(listSignatures(db, modId));
  });

  // PATCH /api/strings/:stringId/translation — save inline edit
  app.patch<{
    Params: { stringId: string };
    Body: { text: string; status?: 'human' | 'fuzzy' | 'auto' | 'tm' };
  }>('/api/strings/:stringId/translation', async (req, reply) => {
    const stringId = Number(req.params.stringId);
    if (!Number.isInteger(stringId) || stringId < 1) {
      return reply.code(400).send({ error: 'Invalid string id' });
    }

    const { text, status = 'human' } = req.body ?? {};
    if (typeof text !== 'string' || text.trim() === '') {
      return reply.code(400).send({ error: 'text is required' });
    }

    const result = upsertTranslation(db, stringId, text, status);
    return reply.send(result);
  });

  // PATCH /api/strings/:stringId/status — change status only (approve / reject)
  app.patch<{
    Params: { stringId: string };
    Body: { translationId: number; status: string };
  }>('/api/strings/:stringId/status', async (req, reply) => {
    const { translationId, status } = req.body ?? {};
    if (!translationId || !status) {
      return reply.code(400).send({ error: 'translationId and status are required' });
    }
    updateTranslationStatus(db, translationId, status);
    return reply.send({ ok: true });
  });

  // POST /api/strings/translate — batch LLM translate
  app.post<{
    Body: { stringIds: number[]; targetLang?: string };
  }>('/api/strings/translate', async (req, reply) => {
    const { stringIds, targetLang = 'uk' } = req.body ?? {};
    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (stringIds.length > 100) {
      return reply.code(400).send({ error: 'Max 100 strings per batch' });
    }

    const results: Array<{ stringId: number; text?: string; error?: string }> = [];

    for (const stringId of stringIds) {
      const row = db
        .prepare(`SELECT text_raw FROM strings WHERE id = ? AND lang = 'en'`)
        .get(stringId) as { text_raw: string } | undefined;

      if (!row) {
        results.push({ stringId, error: 'not found' });
        continue;
      }

      try {
        const translated = await chatWithFallback({
          model: CONFIG.translateModel,
          messages: [
            {
              role: 'system',
              content: `You are a professional game localizer. Translate the following Fallout 4 game text from English to ${targetLang}. Output only the translated text, nothing else.`,
            },
            { role: 'user', content: row.text_raw },
          ],
        });

        upsertTranslation(db, stringId, translated, 'auto');
        results.push({ stringId, text: translated });
      } catch (err) {
        log.error({ err, stringId }, 'LLM translate failed for string');
        results.push({ stringId, error: String(err) });
      }
    }

    return reply.send({ results });
  });
}
