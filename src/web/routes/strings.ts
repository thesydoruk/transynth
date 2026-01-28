import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import {
  listStrings,
  listSignatures,
  upsertTranslation,
  updateTranslationStatus,
  deleteTranslation,
  getStringTextNorm,
  getTMSuggestions,
  getTranslationHistory,
  getQAIssues,
} from '../queries.js';
import { propagateTranslation } from '../tm.js';
import { cacheLookup, cacheStore } from '../cacheService.js';
import { chatWithFallback } from '../../llm/index.js';
import { CONFIG } from '../../config.js';
import { log } from '../../logger.js';

export const stringsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/strings?modId=&srcLang=&targetLang=&status=&signature=&q=&page=&pageSize=
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      signature?: string;
      q?: string;
      page?: string;
      pageSize?: string;
      sort?: string;
      order?: string;
    };
  }>('/api/strings', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const result = await listStrings(db, {
      modId,
      srcLang: req.query.srcLang,
      targetLang: req.query.targetLang,
      status: req.query.status,
      query: req.query.q,
      signature: req.query.signature,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      sort: req.query.sort,
      order: req.query.order === 'desc' ? 'desc' : req.query.order === 'asc' ? 'asc' : undefined,
    });

    return reply.send(result);
  });

  // GET /api/strings/signatures?modId=&srcLang=
  app.get<{ Querystring: { modId?: string; srcLang?: string } }>('/api/strings/signatures', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(await listSignatures(db, modId, req.query.srcLang));
  });

  // GET /api/strings/:stringId/suggestions?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/suggestions',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? 'uk';
      const suggestions = await getTMSuggestions(db, stringId, targetLang);
      return reply.send(suggestions);
    },
  );

  // GET /api/strings/:stringId/history?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/history',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? 'uk';
      return reply.send(await getTranslationHistory(db, stringId, targetLang));
    },
  );

  // GET /api/strings/:stringId/qa?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/qa',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? 'uk';
      return reply.send(await getQAIssues(db, stringId, targetLang));
    },
  );

  // PATCH /api/strings/:stringId/translation — save inline edit
  app.patch<{
    Params: { stringId: string };
    Body: { text: string; status?: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm'; targetLang?: string };
  }>('/api/strings/:stringId/translation', async (req, reply) => {
    const stringId = Number(req.params.stringId);
    if (!Number.isInteger(stringId) || stringId < 1) {
      return reply.code(400).send({ error: 'Invalid string id' });
    }

    const { text, status = 'draft', targetLang = 'uk' } = req.body ?? {};
    if (typeof text !== 'string') {
      return reply.code(400).send({ error: 'text is required' });
    }

    if (text.trim() === '') {
      return reply.send(await deleteTranslation(db, stringId, targetLang));
    }

    const result = await upsertTranslation(db, stringId, text, status, targetLang);

    // Propagate to all strings with the same normalised source text
    const textNorm = await getStringTextNorm(db, stringId);
    if (textNorm) {
      await propagateTranslation(db, textNorm, text, targetLang, stringId);
    }

    return reply.send(result);
  });

  // DELETE /api/strings/:stringId/translation?targetLang=
  app.delete<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/translation',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? 'uk';
      return reply.send(await deleteTranslation(db, stringId, targetLang));
    },
  );

  // PATCH /api/strings/:stringId/status — change status only (approve / reject)
  app.patch<{
    Params: { stringId: string };
    Body: { translationId: number; status: string };
  }>('/api/strings/:stringId/status', async (req, reply) => {
    const { translationId, status } = req.body ?? {};
    if (!translationId || !status) {
      return reply.code(400).send({ error: 'translationId and status are required' });
    }
    await updateTranslationStatus(db, translationId, status);
    return reply.send({ ok: true });
  });

  // POST /api/strings/translate — batch LLM translate with SSE progress stream
  app.post<{
    Body: { stringIds: number[]; srcLang?: string; targetLang?: string };
  }>('/api/strings/translate', async (req, reply) => {
    const { stringIds, srcLang = 'en', targetLang = 'uk' } = req.body ?? {};
    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (stringIds.length > 100) {
      return reply.code(400).send({ error: 'Max 100 strings per batch' });
    }

    // Load glossary terms to inject into system prompt
    const { rows: glossaryRows } = await db.query(
      `SELECT term, translation FROM glossary WHERE src_lang = $1 AND tgt_lang = $2 ORDER BY term LIMIT 80`,
      [srcLang, targetLang],
    );

    const glossaryHint =
      glossaryRows.length > 0
        ? `\n\nKey terminology to preserve:\n${glossaryRows.map((g: { term: string; translation: string | null }) => g.translation ? `- ${g.term} → ${g.translation}` : `- ${g.term}`).join('\n')}`
        : '';

    const systemPrompt = `You are a professional Fallout 4 game localizer. Translate from ${srcLang} to ${targetLang}. Output only the translated text, nothing else.${glossaryHint}`;

    // Hijack reply and stream SSE
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: object) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const results: Array<{ stringId: number; text?: string; error?: string }> = [];

    for (let i = 0; i < stringIds.length; i++) {
      const stringId = stringIds[i];
      const { rows: strRows } = await db.query(
        `SELECT text_raw FROM strings WHERE id = $1 AND lang = $2`,
        [stringId, srcLang],
      );

      if (!strRows[0]) {
        const r = { stringId, error: 'not found' };
        results.push(r);
        send({ type: 'progress', done: i + 1, total: stringIds.length, result: r });
        continue;
      }

      const sourceText = strRows[0].text_raw;

      try {
        // Check LLM translation cache first
        const cached = await cacheLookup(db, sourceText, srcLang, targetLang, CONFIG.translateModel);
        let translated: string;

        if (cached) {
          translated = cached.translated;
        } else {
          translated = await chatWithFallback({
            model: CONFIG.translateModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: sourceText },
            ],
          });

          // Store in cache for future lookups
          await cacheStore(db, sourceText, srcLang, targetLang, CONFIG.translateModel, translated);
        }

        await upsertTranslation(db, stringId, translated, 'auto', targetLang);
        const r = { stringId, text: translated };
        results.push(r);
        send({ type: 'progress', done: i + 1, total: stringIds.length, result: r });
      } catch (err) {
        log.error({ err, stringId }, 'LLM translate failed for string');
        const r = { stringId, error: String(err) };
        results.push(r);
        send({ type: 'progress', done: i + 1, total: stringIds.length, result: r });
      }
    }

    send({ type: 'done', results });
    reply.raw.end();
  });
}
