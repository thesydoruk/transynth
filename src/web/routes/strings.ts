import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import {
  listStrings,
  listMatchingStringIds,
  listSignatures,
  upsertTranslation,
  deleteTranslation,
  deleteTranslationsBatch,
  deleteTranslationsByFilter,
  getStringTextNorm,
  getRagSuggestions,
  getTranslationHistory,
  getQAIssues,
  markStringsAsSkip,
  unmarkStringsSkip,
} from '../queries';
import { propagateTranslation } from '../tm';
import { getAllProjectSettings } from '../projectSettings';
import { CONFIG } from '../../config';
import { translateStringIdsBatch } from '../llmTranslateBatch';
import { log } from '../../logger';

export const stringsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/strings?modId=&srcLang=&targetLang=&status=&signature=&q=&grup=&formid=&edid=&field=&page=&pageSize=
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: string;
      signature?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: string;
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
      qaOnly: req.query.qaOnly === '1' || req.query.qaOnly === 'true',
      query: req.query.q,
      signature: req.query.signature,
      grup: req.query.grup,
      formid: req.query.formid,
      edid: req.query.edid,
      field: req.query.field,
      src: req.query.src,
      transl: req.query.transl,
      hideIgnored: req.query.hideIgnored === '1' || req.query.hideIgnored === 'true',
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      sort: req.query.sort,
      order: req.query.order === 'desc' ? 'desc' : req.query.order === 'asc' ? 'asc' : undefined,
    });

    return reply.send(result);
  });

  // GET /api/strings/ids?modId=&...filters — all string IDs matching a filter.
  //
  // Powers the editor's "select all matching" feature for client-side bulk
  // actions (e.g. batch translate) that still need an explicit ID list.
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: string;
      signature?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: string;
    };
  }>('/api/strings/ids', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const ids = await listMatchingStringIds(db, {
      modId,
      srcLang: req.query.srcLang,
      targetLang: req.query.targetLang,
      status: req.query.status,
      qaOnly: req.query.qaOnly === '1' || req.query.qaOnly === 'true',
      query: req.query.q,
      signature: req.query.signature,
      grup: req.query.grup,
      formid: req.query.formid,
      edid: req.query.edid,
      field: req.query.field,
      src: req.query.src,
      transl: req.query.transl,
      hideIgnored: req.query.hideIgnored === '1' || req.query.hideIgnored === 'true',
    });
    return reply.send({ ids });
  });

  // GET /api/strings/signatures?modId=&srcLang=&targetLang=&status=&…
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: string;
    };
  }>('/api/strings/signatures', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(
      await listSignatures(db, {
        modId,
        srcLang: req.query.srcLang,
        targetLang: req.query.targetLang,
        status: req.query.status,
        qaOnly: req.query.qaOnly === '1' || req.query.qaOnly === 'true',
        query: req.query.q,
        grup: req.query.grup,
        formid: req.query.formid,
        edid: req.query.edid,
        field: req.query.field,
        src: req.query.src,
        transl: req.query.transl,
        hideIgnored: req.query.hideIgnored === '1' || req.query.hideIgnored === 'true',
      }),
    );
  });

  // GET /api/strings/:stringId/suggestions?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/suggestions',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const suggestions = await getRagSuggestions(db, stringId, targetLang);
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
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
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
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      return reply.send(await getQAIssues(db, stringId, targetLang));
    },
  );

  // PATCH /api/strings/:stringId/translation — save inline edit
  app.patch<{
    Params: { stringId: string };
    Body: {
      text: string;
      status?: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' | 'skip';
      targetLang?: string;
    };
  }>('/api/strings/:stringId/translation', async (req, reply) => {
    const stringId = Number(req.params.stringId);
    if (!Number.isInteger(stringId) || stringId < 1) {
      return reply.code(400).send({ error: 'Invalid string id' });
    }

    const { text, status = 'draft', targetLang = CONFIG.defaultTgtLang } = req.body ?? {};
    if (typeof text !== 'string') {
      return reply.code(400).send({ error: 'text is required' });
    }

    if (text.trim() === '') {
      return reply.send(await deleteTranslation(db, stringId, targetLang));
    }

    // Read project settings to determine effective save status and propagation.
    const projectSettings = await getAllProjectSettings(db);

    // When auto_approve_on_save is enabled and the client submitted a regular
    // draft save, promote the status directly to reviewed so the string skips
    // the review queue.
    const effectiveStatus: typeof status =
      projectSettings['workflow.auto_approve_on_save'] && status === 'draft' ? 'reviewed' : status;

    const result = await upsertTranslation(
      db,
      stringId,
      text,
      effectiveStatus,
      targetLang,
      undefined,
      undefined,
      req.user?.id ?? null,
    );

    // Propagate to all strings with the same normalised source text (unless disabled).
    if (projectSettings['workflow.propagate_to_identical']) {
      const textNorm = await getStringTextNorm(db, stringId);
      if (textNorm) {
        await propagateTranslation(db, textNorm, text, targetLang, stringId);
      }
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
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      return reply.send(await deleteTranslation(db, stringId, targetLang));
    },
  );

  // PATCH /api/strings/:stringId/ignore — toggle the is_ignored flag
  //
  // Marking a string as ignored excludes it from the default editor view when
  // the `workflow.hide_ignored_by_default` project setting is enabled.
  // Body: { ignore: boolean }
  app.patch<{
    Params: { stringId: string };
    Body: { ignore: boolean };
  }>('/api/strings/:stringId/ignore', async (req, reply) => {
    const stringId = Number(req.params.stringId);
    if (!Number.isInteger(stringId) || stringId < 1) {
      return reply.code(400).send({ error: 'Invalid string id' });
    }
    const { ignore } = req.body ?? {};
    if (typeof ignore !== 'boolean') {
      return reply.code(400).send({ error: 'ignore (boolean) is required' });
    }
    const { rows } = await db.query<{ id: number; is_ignored: boolean }>(
      `UPDATE strings SET is_ignored = $2 WHERE id = $1 RETURNING id, is_ignored`,
      [stringId, ignore],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'String not found' });
    return reply.send(rows[0]);
  });

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
};
