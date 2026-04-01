/**
 * tradAuto.ts — CRUD + apply + learn routes for the TradAuto rule engine.
 *
 * Endpoints:
 *
 * | Method | Path                          | Purpose                                  |
 * | ------ | ----------------------------- | ---------------------------------------- |
 * | GET    | `/api/tradauto`               | List rules (filtered by game / lang)     |
 * | GET    | `/api/tradauto/:id`           | Get a single rule                        |
 * | POST   | `/api/tradauto`               | Create a new rule                        |
 * | PUT    | `/api/tradauto/:id`           | Update an existing rule                  |
 * | DELETE | `/api/tradauto/:id`           | Delete a rule                            |
 * | POST   | `/api/tradauto/test`          | Dry-run: test rules against sample text  |
 * | POST   | `/api/tradauto/apply/:modId`  | Apply rules to untranslated strings      |
 * | POST   | `/api/tradauto/learn`         | Discover rule candidates from TM pairs   |
 */

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import {
  compileRule,
  loadActiveRules,
  applyRules,
  type TradAutoRule,
  type MatchInput,
} from '../tradAutoEngine';
import { upsertTranslation } from '../queries';
import { CONFIG } from '../../config';
import { discoverPatterns, type DiscoverOptions } from '../tradAutoLearn';

/* ── Route registration ──────────────────────────────────────────────────── */

export const tradAutoRoutes = async (app: FastifyInstance, db: Tx) => {

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  CRUD                                                                 */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * GET /api/tradauto — list all rules with optional filters.
   *
   * Query params: `game`, `srcLang`, `tgtLang`, `isActive`.
   */
  app.get<{
    Querystring: { game?: string; srcLang?: string; tgtLang?: string; isActive?: string };
  }>('/api/tradauto', async (req, reply) => {
    const { game, srcLang, tgtLang, isActive } = req.query;

    const conds: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (game) { conds.push(`game = $${idx++}`); params.push(game); }
    if (srcLang) { conds.push(`src_lang = $${idx++}`); params.push(srcLang); }
    if (tgtLang) { conds.push(`tgt_lang = $${idx++}`); params.push(tgtLang); }
    if (isActive !== undefined) { conds.push(`is_active = $${idx++}`); params.push(isActive === 'true'); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, game, priority, pattern, replacement, signature, path,
              src_lang, tgt_lang, description, is_active, created_at, updated_at
       FROM tradauto_rules ${where}
       ORDER BY priority ASC, id ASC`,
      params,
    );

    return reply.send(rows);
  });

  /** GET /api/tradauto/:id — get a single rule by id. */
  app.get<{ Params: { id: string } }>('/api/tradauto/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const { rows } = await db.query(
      `SELECT id, game, priority, pattern, replacement, signature, path,
              src_lang, tgt_lang, description, is_active, created_at, updated_at
       FROM tradauto_rules WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });

  /**
   * POST /api/tradauto — create a new rule.
   *
   * Required fields: `pattern`, `replacement`.
   */
  app.post<{
    Body: {
      game?: string;
      priority?: number;
      pattern: string;
      replacement: string;
      signature?: string | null;
      path?: string | null;
      src_lang?: string;
      tgt_lang?: string;
      description?: string | null;
      is_active?: boolean;
    };
  }>('/api/tradauto', async (req, reply) => {
    const body = req.body ?? {} as Record<string, unknown>;
    const {
      game = 'fo4',
      priority = 100,
      pattern,
      replacement,
      signature = null,
      path = null,
      src_lang = CONFIG.defaultSrcLang,
      tgt_lang = CONFIG.defaultTgtLang,
      description = null,
      is_active = true,
    } = body;

    if (!pattern || !replacement) {
      return reply.code(400).send({ error: 'pattern and replacement are required' });
    }

    /* Validate that the pattern compiles without error. */
    try {
      compileRule({
        id: 0, game, priority, pattern, replacement,
        signature, path, src_lang, tgt_lang, description, is_active,
      });
    } catch (e) {
      return reply.code(400).send({ error: `Invalid pattern: ${(e as Error).message}` });
    }

    log.info(`POST /api/tradauto pattern="${pattern}" → "${replacement}" sig=${signature ?? '*'} path=${path ?? '*'}`);

    const { rows } = await db.query(
      `INSERT INTO tradauto_rules(game, priority, pattern, replacement, signature, path,
                                   src_lang, tgt_lang, description, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [game, priority, pattern, replacement, signature || null, path || null,
       src_lang, tgt_lang, description || null, is_active],
    );

    return reply.code(201).send(rows[0]);
  });

  /** PUT /api/tradauto/:id — update an existing rule. */
  app.put<{
    Params: { id: string };
    Body: {
      game?: string;
      priority?: number;
      pattern?: string;
      replacement?: string;
      signature?: string | null;
      path?: string | null;
      src_lang?: string;
      tgt_lang?: string;
      description?: string | null;
      is_active?: boolean;
    };
  }>('/api/tradauto/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const body = req.body ?? {} as Record<string, unknown>;

    /* If pattern is being changed, validate compilation. */
    if (body.pattern !== undefined) {
      try {
        compileRule({
          id, game: body.game ?? 'fo4', priority: body.priority ?? 100,
          pattern: body.pattern, replacement: body.replacement ?? '',
          signature: null, path: null, src_lang: CONFIG.defaultSrcLang, tgt_lang: CONFIG.defaultTgtLang,
          description: null, is_active: true,
        });
      } catch (e) {
        return reply.code(400).send({ error: `Invalid pattern: ${(e as Error).message}` });
      }
    }

    const allowed = [
      'game', 'priority', 'pattern', 'replacement', 'signature',
      'path', 'src_lang', 'tgt_lang', 'description', 'is_active',
    ] as const;

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (key in body) {
        fields.push(`${key} = $${idx++}`);
        const val = body[key as keyof typeof body];
        params.push(
          (key === 'signature' || key === 'path' || key === 'description') && val === ''
            ? null
            : val ?? null,
        );
      }
    }

    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(id);

    const { rows } = await db.query(
      `UPDATE tradauto_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );

    if (rows.length === 0) return reply.code(404).send({ error: 'Not found' });
    return reply.send(rows[0]);
  });

  /** DELETE /api/tradauto/:id — delete a rule. */
  app.delete<{ Params: { id: string } }>('/api/tradauto/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const result = await db.query('DELETE FROM tradauto_rules WHERE id = $1', [id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Not found' });

    log.info(`DELETE /api/tradauto/${id}`);
    return reply.send({ ok: true });
  });

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  Test & Apply                                                         */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/tradauto/test — dry-run rule matching against sample texts.
   *
   * Body: `{ texts: string[], game?, srcLang?, tgtLang? }`
   * Returns: parallel array of `{ ruleId, translated } | null`.
   */
  app.post<{
    Body: {
      texts: string[];
      game?: string;
      srcLang?: string;
      tgtLang?: string;
    };
  }>('/api/tradauto/test', async (req, reply) => {
    const { texts, game = 'fo4', srcLang = CONFIG.defaultSrcLang, tgtLang = CONFIG.defaultTgtLang } = req.body ?? {} as Record<string, unknown>;

    if (!Array.isArray(texts) || texts.length === 0) {
      return reply.code(400).send({ error: 'texts array is required' });
    }
    if (texts.length > 500) {
      return reply.code(400).send({ error: 'Maximum 500 test texts' });
    }

    const rules = await loadActiveRules(db, game, srcLang, tgtLang);
    const compiled = rules.map(compileRule);

    const inputs: MatchInput[] = texts.map((t) => ({ text: t }));
    const results = applyRules(compiled, inputs);

    return reply.send({ results });
  });

  /**
   * POST /api/tradauto/apply/:modId — apply TradAuto rules to a mod's
   * untranslated strings and save the results as translations.
   *
   * Only strings without any existing translation (for the given target
   * language) are considered.  Translations are saved with status `auto`
   * and provenance `tradauto`.
   *
   * Body: `{ targetLang?, srcLang?, game?, dryRun? }`
   * Returns: `{ matched, saved, total }` (dryRun omits the save step).
   */
  app.post<{
    Params: { modId: string };
    Body: {
      targetLang?: string;
      srcLang?: string;
      game?: string;
      dryRun?: boolean;
    };
  }>('/api/tradauto/apply/:modId', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const {
      targetLang = CONFIG.defaultTgtLang,
      srcLang = CONFIG.defaultSrcLang,
      game = 'fo4',
      dryRun = false,
    } = req.body ?? {} as Record<string, unknown>;

    /* Load and compile rules. */
    const rules = await loadActiveRules(db, game, srcLang, targetLang);
    if (rules.length === 0) {
      return reply.send({ matched: 0, saved: 0, total: 0, message: 'No active rules' });
    }
    const compiled = rules.map(compileRule);

    /* Fetch untranslated source strings for this mod. */
    const { rows: untranslated } = await db.query(
      `SELECT s.id AS string_id, s.text_raw, r.signature, r.path
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1
         AND s.lang = $2
         AND NOT EXISTS (
           SELECT 1 FROM translations t
           WHERE t.src_string_id = s.id AND t.target_lang = $3
         )
       ORDER BY r.id, s.id`,
      [modId, srcLang, targetLang],
    );

    if (untranslated.length === 0) {
      return reply.send({ matched: 0, saved: 0, total: 0 });
    }

    /* Build inputs for the engine. */
    const inputs: MatchInput[] = untranslated.map((r: Record<string, unknown>) => ({
      text: r.text_raw as string,
      signature: r.signature as string | null,
      path: r.path as string | null,
    }));

    const results = applyRules(compiled, inputs);

    const matched = results.filter(Boolean).length;
    let saved = 0;

    if (!dryRun) {
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result) continue;

        const row = untranslated[i] as { string_id: number };
        await upsertTranslation(
          db,
          row.string_id,
          result.translated,
          'auto',
          targetLang,
          'tradauto',
          `rule_${result.ruleId}`,
        );
        saved++;
      }

      log.info(`TradAuto apply modId=${modId}: ${saved}/${untranslated.length} strings translated by rules`);
    }

    return reply.send({
      matched,
      saved: dryRun ? 0 : saved,
      total: untranslated.length,
      dryRun,
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  Rule Learning (pattern discovery from TM)                            */
  /* ═══════════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/tradauto/learn — discover rule candidates from translation
   * memory using prefix/suffix pattern analysis.
   *
   * Body: `{ game?, srcLang?, tgtLang?, minOccurrences?, limit? }`
   * Returns: `{ candidates: RuleCandidate[] }`
   *
   * The returned candidates are **not** saved automatically — the user
   * reviews them on the frontend and adds approved ones via the normal
   * `POST /api/tradauto` create endpoint.
   */
  app.post<{
    Body: {
      game?: string;
      srcLang?: string;
      tgtLang?: string;
      minOccurrences?: number;
      limit?: number;
    };
  }>('/api/tradauto/learn', async (req, reply) => {
    const body = (req.body ?? {}) as DiscoverOptions;

    const minOcc = Number(body.minOccurrences) || 3;
    if (minOcc < 2 || minOcc > 100) {
      return reply.code(400).send({ error: 'minOccurrences must be between 2 and 100' });
    }

    const lim = Number(body.limit) || 50;
    if (lim < 1 || lim > 500) {
      return reply.code(400).send({ error: 'limit must be between 1 and 500' });
    }

    const candidates = await discoverPatterns(db, {
      game: body.game,
      srcLang: body.srcLang,
      tgtLang: body.tgtLang,
      minOccurrences: minOcc,
      limit: lim,
    });

    return reply.send({ candidates });
  });
};
