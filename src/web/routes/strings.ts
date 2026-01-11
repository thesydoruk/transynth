import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listStrings, listSignatures, upsertTranslation, updateTranslationStatus, getStringTextNorm } from '../queries.js';
import { propagateTranslation } from '../tm.js';
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

    const result = await listStrings(db, {
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
    return reply.send(await listSignatures(db, modId));
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

    const result = await upsertTranslation(db, stringId, text, status);

    // Propagate to all strings with the same normalised source text
    const textNorm = await getStringTextNorm(db, stringId);
    if (textNorm) {
      await propagateTranslation(db, textNorm, text, 'uk', stringId);
    }

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
    await updateTranslationStatus(db, translationId, status);
    return reply.send({ ok: true });
  });

  // POST /api/strings/translate — batch LLM translate with SSE progress stream
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

    // Load glossary terms to inject into system prompt
    const { rows: glossaryRows } = await db.query(
      `SELECT term FROM glossary WHERE lang = $1 ORDER BY count DESC LIMIT 80`,
      [targetLang],
    );

    const glossaryHint =
      glossaryRows.length > 0
        ? `\n\nKey terminology to preserve:\n${glossaryRows.map((g: { term: string }) => `- ${g.term}`).join('\n')}`
        : '';

    const systemPrompt = `You are a professional Fallout 4 game localizer. Translate from English to ${targetLang}. Output only the translated text, nothing else.${glossaryHint}`;

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
        `SELECT text_raw FROM strings WHERE id = $1 AND lang = 'en'`,
        [stringId],
      );

      if (!strRows[0]) {
        const r = { stringId, error: 'not found' };
        results.push(r);
        send({ type: 'progress', done: i + 1, total: stringIds.length, result: r });
        continue;
      }

      try {
        const translated = await chatWithFallback({
          model: CONFIG.translateModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: strRows[0].text_raw },
          ],
        });

        await upsertTranslation(db, stringId, translated, 'auto');
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
