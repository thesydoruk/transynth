import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import {
  deleteTranslationsBatch,
  deleteTranslationsByFilter,
  markStringsAsSkip,
  unmarkStringsSkip,
  setTranslationsStatus,
} from '../../data/queries';
import { isValidTranslationStatus } from '../../data/statusMachine';
import { applyTMToStringIds } from '../../services/tm';
import { CONFIG } from '../../../config';
import { translateStringIdsBatch } from '../../llm/translateBatch';
import { log } from '../../../logger';

export const registerBatchRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/strings/clear-translations — batch clear target-language translations
  app.post<{
    Body: {
      stringIds?: number[];
      modId?: number;
      filter?: {
        srcLang?: string;
        targetLang?: string;
        status?: string;
        qaOnly?: boolean;
        signature?: string;
        q?: string;
        grup?: string;
        formid?: string;
        edid?: string;
        field?: string;
        src?: string;
        transl?: string;
        hideIgnored?: boolean;
      };
      excludeIds?: number[];
      targetLang?: string;
    };
  }>('/api/strings/clear-translations', async (req, reply) => {
    const { stringIds, modId, filter, excludeIds, targetLang: bodyTargetLang } = req.body ?? {};
    const targetLang = bodyTargetLang?.trim() || CONFIG.defaultTgtLang;

    if (modId != null && filter) {
      const id = Number(modId);
      if (!Number.isInteger(id) || id < 1) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }
      const excluded = Array.isArray(excludeIds)
        ? excludeIds.filter((x) => Number.isInteger(x) && x > 0)
        : [];
      return reply.send(
        await deleteTranslationsByFilter(
          db,
          {
            modId: id,
            srcLang: filter.srcLang,
            targetLang: filter.targetLang,
            status: filter.status,
            qaOnly: filter.qaOnly,
            signature: filter.signature,
            query: filter.q,
            grup: filter.grup,
            formid: filter.formid,
            edid: filter.edid,
            field: filter.field,
            src: filter.src,
            transl: filter.transl,
            hideIgnored: filter.hideIgnored,
          },
          excluded,
          targetLang,
        ),
      );
    }

    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (!stringIds.every((id) => Number.isInteger(id) && id > 0)) {
      return reply.code(400).send({ error: 'Invalid stringIds' });
    }
    return reply.send(await deleteTranslationsBatch(db, stringIds, targetLang));
  });

  // POST /api/strings/set-status — batch-assign translation status (text unchanged)
  app.post<{
    Body: {
      stringIds: number[];
      status: string;
      targetLang?: string;
    };
  }>('/api/strings/set-status', async (req, reply) => {
    const stringIds = req.body?.stringIds;
    const status = req.body?.status;
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (!stringIds.every((id) => Number.isInteger(id) && id > 0)) {
      return reply.code(400).send({ error: 'Invalid stringIds' });
    }
    if (
      typeof status !== 'string' ||
      !isValidTranslationStatus(status) ||
      status === 'skip' ||
      status === 'deleted'
    ) {
      return reply.code(400).send({ error: 'Invalid status' });
    }
    const updated = await setTranslationsStatus(db, stringIds, status, targetLang);
    return reply.send({ ok: true, updated });
  });

  // POST /api/strings/mark-skip — set skip flag (global is_ignored)
  app.post<{
    Body: { stringIds: number[]; skip?: boolean };
  }>('/api/strings/mark-skip', async (req, reply) => {
    const stringIds = req.body?.stringIds;
    const skip = req.body?.skip !== false;
    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (!stringIds.every((id) => Number.isInteger(id) && id > 0)) {
      return reply.code(400).send({ error: 'Invalid stringIds' });
    }
    const marked = skip
      ? await markStringsAsSkip(db, stringIds)
      : await unmarkStringsSkip(db, stringIds);
    return reply.send({ ok: true, marked });
  });

  // POST /api/strings/translate — batch LLM translate with SSE progress stream
  app.post<{
    Body: { stringIds: number[]; srcLang?: string; targetLang?: string; modId?: number };
  }>('/api/strings/translate', async (req, reply) => {
    const {
      stringIds,
      srcLang = CONFIG.defaultSrcLang,
      targetLang = CONFIG.defaultTgtLang,
      modId: bodyModId,
    } = req.body ?? {};
    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (stringIds.length > 100) {
      return reply.code(400).send({ error: 'Max 100 strings per batch' });
    }

    let resolvedModId: number | null = bodyModId ?? null;
    let resolvedModGame: string | null = null;
    let resolvedModName: string | null = null;
    if (resolvedModId === null && stringIds[0] !== undefined) {
      try {
        const { rows: modRows } = await db.query<{ mod_id: number; game: string; name: string }>(
          `SELECT r.mod_id, m.game, m.name
             FROM strings s
             JOIN records r ON r.id = s.record_id
             JOIN mods m ON m.id = r.mod_id
            WHERE s.id = $1 LIMIT 1`,
          [stringIds[0]],
        );
        if (modRows[0]) {
          resolvedModId = modRows[0].mod_id;
          resolvedModGame = modRows[0].game;
          resolvedModName = modRows[0].name;
        }
      } catch (lookupErr) {
        log.warn({ lookupErr }, 'llm_jobs: failed to resolve mod for job tracking');
      }
    }

    let llmJobId: number | null = null;
    try {
      const { rows: jobRows } = await db.query<{ id: number }>(
        `INSERT INTO llm_jobs (mod_id, mod_game, mod_name, string_count, done_count, status)
         VALUES ($1, $2, $3, $4, 0, 'running') RETURNING id`,
        [resolvedModId, resolvedModGame, resolvedModName, stringIds.length],
      );
      llmJobId = jobRows[0]?.id ?? null;
    } catch (insertErr) {
      log.warn({ insertErr }, 'llm_jobs: failed to insert job row');
    }

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

    const results = await translateStringIdsBatch(db, stringIds, {
      srcLang,
      targetLang,
      modGame: resolvedModGame,
      modName: resolvedModName,
      overwriteMode: 'force',
      onProgress: (done, total, result) => {
        send({ type: 'progress', done, total, result });
      },
    });

    send({ type: 'done', results });
    reply.raw.end();

    if (llmJobId !== null) {
      const successCount = results.filter((r) => r.text !== undefined).length;
      const failed = results.some((r) => r.error !== undefined && r.text === undefined);
      const finalStatus = failed && successCount === 0 ? 'failed' : 'completed';
      const firstError = results.find((r) => r.error)?.error ?? null;
      try {
        await db.query(
          `UPDATE llm_jobs
              SET status = $1, done_count = $2, error = $3, updated_at = NOW()
            WHERE id = $4`,
          [finalStatus, successCount, firstError, llmJobId],
        );
      } catch (updateErr) {
        log.warn({ updateErr, llmJobId }, 'llm_jobs: failed to finalize job row');
      }
    }
  });

  // POST /api/strings/tm-apply — apply translation memory to selected string IDs
  app.post<{
    Body: { stringIds: number[]; srcLang?: string; targetLang?: string; modId?: number };
  }>('/api/strings/tm-apply', async (req, reply) => {
    const {
      stringIds,
      srcLang = CONFIG.defaultSrcLang,
      targetLang = CONFIG.defaultTgtLang,
      modId: bodyModId,
    } = req.body ?? {};
    if (!Array.isArray(stringIds) || stringIds.length === 0) {
      return reply.code(400).send({ error: 'stringIds array is required' });
    }
    if (stringIds.length > 100) {
      return reply.code(400).send({ error: 'Max 100 strings per batch' });
    }
    if (!stringIds.every((id) => Number.isInteger(id) && id > 0)) {
      return reply.code(400).send({ error: 'Invalid stringIds' });
    }

    let resolvedModId: number | null = bodyModId ?? null;
    if (resolvedModId === null && stringIds[0] !== undefined) {
      const { rows: modRows } = await db.query<{ mod_id: number }>(
        `SELECT r.mod_id
           FROM strings s
           JOIN records r ON r.id = s.record_id
          WHERE s.id = $1 LIMIT 1`,
        [stringIds[0]],
      );
      resolvedModId = modRows[0]?.mod_id ?? null;
    }
    if (resolvedModId === null) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const result = await applyTMToStringIds(db, resolvedModId, stringIds, targetLang, srcLang);
    return reply.send({ ok: true, ...result });
  });
};
