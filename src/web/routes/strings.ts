import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
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
} from '../queries';
import { propagateTranslation } from '../tm';
import { getAllProjectSettings } from '../projectSettings';
import { cacheLookup, cacheStore } from '../cacheService';
import { getTranslateModel, CONFIG } from '../../config';
import {
  translateStrings,
  type LlmGlossaryEntry,
  type LlmTranslateItem,
} from '../../llm/translate';
import { fetchReferenceExamplesBatch } from '../../llm/ragService';
import { log } from '../../logger';
import { maskFunctionKeywords, maskPlaceholders, unmask } from '../../utils/placeholders';
import { reachableStatuses, isValidTranslationStatus } from '../statusMachine';
import type { TranslationStatus } from '../statusMachine';
import type { GameType } from '../../types';

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

  // GET /api/strings/signatures?modId=&srcLang=
  app.get<{ Querystring: { modId?: string; srcLang?: string } }>(
    '/api/strings/signatures',
    async (req, reply) => {
      const modId = Number(req.query.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'modId is required' });
      }
      return reply.send(await listSignatures(db, modId, req.query.srcLang));
    },
  );

  // GET /api/strings/status-transitions?from=
  //
  // Returns the list of statuses that the currently authenticated user can
  // transition to from a given current status.  The frontend uses this to
  // enable/disable status-change actions in the editor toolbar and context menu.
  //
  // Query params:
  //   from  — current TranslationStatus value (required)
  //
  // Response: { from: string; actor: string; reachable: string[] }
  app.get<{ Querystring: { from?: string } }>(
    '/api/strings/status-transitions',
    async (req, reply) => {
      const from = req.query.from ?? '';
      if (!isValidTranslationStatus(from)) {
        return reply.code(400).send({ error: `Invalid 'from' status: '${from}'` });
      }
      const actor = req.user?.role ?? 'translator';
      return reply.send({
        from,
        actor,
        reachable: reachableStatuses(from as TranslationStatus, actor),
      });
    },
  );

  // GET /api/strings/:stringId/suggestions?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/suggestions',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
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
      status?: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm';
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

  // PATCH /api/strings/:stringId/status — change status only (approve / reject)
  app.patch<{
    Params: { stringId: string };
    Body: { translationId: number; status: string };
  }>('/api/strings/:stringId/status', async (req, reply) => {
    const { translationId, status } = req.body ?? {};
    if (!translationId || !status) {
      return reply.code(400).send({ error: 'translationId and status are required' });
    }
    // Derive the actor from the authenticated user's role so the state machine
    // can enforce permission constraints (e.g. only reviewer/admin may approve).
    const actor = req.user?.role ?? 'translator';
    try {
      await updateTranslationStatus(db, translationId, status, actor);
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return reply.code(code).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return reply.send({ ok: true });
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

    const model = getTranslateModel();

    const { rows: glossaryRows } = await db.query<{ term: string; translation: string | null }>(
      `SELECT term, translation FROM glossary WHERE src_lang = $1 AND tgt_lang = $2 ORDER BY term LIMIT 80`,
      [srcLang, targetLang],
    );
    const glossary: LlmGlossaryEntry[] = glossaryRows;
    const projectSettings = await getAllProjectSettings(db);
    const ragEnabled = projectSettings['llm.rag_enabled'];
    const ragMaxExamples = Math.min(10, Math.max(1, projectSettings['llm.rag_max_examples']));
    const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));

    // Resolve mod metadata for job tracking. Use bodyModId if provided, else
    // derive from the first string. Failures here are non-fatal — we still run.
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

    // Insert a running job row for persistence across page reloads.
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

    type StringRow = {
      id: number;
      text_raw: string;
      text_norm: string | null;
      text_norm_nopunct: string | null;
      context: string | null;
      signature: string | null;
      path: string | null;
      edid: string | null;
      formid_hex: string | null;
      game: string;
      mod_name: string;
    };

    const { rows: loadedRows } = await db.query<StringRow>(
      `SELECT s.id, s.text_raw, s.text_norm, s.text_norm_nopunct, s.context,
              r.signature, r.path, r.edid, r.formid_hex, m.game, m.name AS mod_name
         FROM strings s
         JOIN records r ON r.id = s.record_id
         JOIN mods m ON m.id = r.mod_id
        WHERE s.id = ANY($1::int[]) AND s.lang = $2`,
      [stringIds, srcLang],
    );
    const rowById = new Map(loadedRows.map((row) => [row.id, row]));

    type PreparedLlmItem = {
      stringId: number;
      sourceText: string;
      textNorm: string | null;
      textNormNopunct: string | null;
      placeholderMap: Record<string, string>;
      functionKeywordMap: Record<string, string>;
      game: string | null;
      modName: string | null;
      llmItem: LlmTranslateItem;
    };

    const results: Array<{ stringId: number; text?: string; error?: string }> = [];
    let doneCount = 0;
    const llmBuffer: PreparedLlmItem[] = [];

    const finishResult = async (stringId: number, text: string) => {
      await upsertTranslation(db, stringId, text, 'auto', targetLang);
      const r = { stringId, text };
      results.push(r);
      doneCount++;
      send({ type: 'progress', done: doneCount, total: stringIds.length, result: r });
    };

    const failResult = (stringId: number, error: string) => {
      const r = { stringId, error };
      results.push(r);
      doneCount++;
      send({ type: 'progress', done: doneCount, total: stringIds.length, result: r });
    };

    const flushLlmBuffer = async () => {
      if (llmBuffer.length === 0) return;

      const chunk = llmBuffer.splice(0, llmBuffer.length);
      try {
        let ragByStringId = new Map<number, LlmTranslateItem['reference_examples']>();
        if (ragEnabled) {
          try {
            ragByStringId = await fetchReferenceExamplesBatch(
              db,
              chunk.map((entry) => ({
                stringId: entry.stringId,
                sourceText: entry.sourceText,
                textNorm: entry.textNorm,
                textNormNopunct: entry.textNormNopunct,
                signature: entry.llmItem.signature,
                path: entry.llmItem.path,
                context: entry.llmItem.context,
              })),
              srcLang,
              targetLang,
              ragMaxExamples,
              ragMinSimilarity,
            );
          } catch (ragErr) {
            log.warn({ ragErr }, 'RAG reference fetch failed, continuing without examples');
          }
        }

        const translations = await translateStrings({
          items: chunk.map((entry) => ({
            ...entry.llmItem,
            reference_examples: ragByStringId.get(entry.stringId),
          })),
          model,
          srcLang,
          targetLang,
          game: resolvedModGame ?? chunk[0]?.game,
          modName: resolvedModName ?? chunk[0]?.modName,
          glossary,
        });

        const translationById = new Map(translations.map((row) => [row.id, row.translation]));

        for (const entry of chunk) {
          const maskedTranslation = translationById.get(entry.stringId);
          if (maskedTranslation === undefined) {
            failResult(entry.stringId, `LLM response missing translation for id=${entry.stringId}`);
            continue;
          }

          const translated = unmask(
            unmask(maskedTranslation, entry.functionKeywordMap),
            entry.placeholderMap,
          );
          await cacheStore(db, entry.sourceText, srcLang, targetLang, model, translated);
          await finishResult(entry.stringId, translated);
        }
      } catch (err) {
        log.error({ err }, 'LLM translate failed for batch');
        const message = err instanceof Error ? err.message : String(err);
        for (const entry of chunk) {
          failResult(entry.stringId, message);
        }
      }
    };

    for (const stringId of stringIds) {
      const row = rowById.get(stringId);
      if (!row) {
        failResult(stringId, 'not found');
        continue;
      }

      const sourceText = row.text_raw;
      const game = row.game ?? resolvedModGame ?? undefined;
      const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(sourceText);
      const { masked: protectedMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
        placeholderMasked,
        game as GameType | undefined,
      );
      const maskedSourceText = protectedMasked;

      const translatableContent = maskedSourceText.replace(/¤(?:PH|GL|FK)\d+¤/g, '').trim();
      if (!translatableContent) {
        await finishResult(stringId, sourceText);
        continue;
      }

      try {
        const cached = await cacheLookup(db, sourceText, srcLang, targetLang, model);
        if (cached) {
          await finishResult(stringId, cached.translated);
          continue;
        }
      } catch (err) {
        log.error({ err, stringId }, 'LLM cache lookup failed');
        failResult(stringId, err instanceof Error ? err.message : String(err));
        continue;
      }

      llmBuffer.push({
        stringId,
        sourceText,
        textNorm: row.text_norm,
        textNormNopunct: row.text_norm_nopunct,
        placeholderMap,
        functionKeywordMap,
        game: row.game ?? resolvedModGame,
        modName: row.mod_name ?? resolvedModName,
        llmItem: {
          id: stringId,
          source: maskedSourceText,
          signature: row.signature,
          path: row.path,
          form_id: row.formid_hex,
          edid: row.edid,
          context: row.context,
        },
      });

      if (llmBuffer.length >= CONFIG.batchSize) {
        await flushLlmBuffer();
      }
    }

    await flushLlmBuffer();

    send({ type: 'done', results });
    reply.raw.end();

    // Finalize the persisted job row. Count only successfully translated strings.
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
