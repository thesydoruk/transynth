import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import {
  getCoherenceGroups,
  resolveAllCoherenceGroups,
  resolveCoherenceGroup,
} from '../data/queries';
import { CONFIG } from '../../config';

/**
 * Coherence-checking routes.
 *
 * "Coherence" means that all source strings with the same normalised text
 * should be translated the same way everywhere.  These endpoints expose a
 * paginated report of inconsistencies and an action to resolve them.
 *
 * Routes:
 *   GET  /api/coherence           — paginated list of inconsistency groups
 *   POST /api/coherence/resolve   — propagate a chosen translation to all
 *                                   strings in a group
 */
export const coherenceRoutes = async (app: FastifyInstance, db: Tx) => {
  // ── GET /api/coherence ────────────────────────────────────────────────────
  // Returns a paginated coherence report for the requested target language.
  // Each group in the response represents a set of source strings that share
  // the same normalised text but have at least two different translations.
  //
  // Query parameters:
  //   targetLang  — ISO language code to check (default: 'uk')
  //   limit       — items per page (default: 50, max: 200)
  //   offset      — page offset (default: 0)
  app.get<{
    Querystring: { targetLang?: string; limit?: string; offset?: string };
  }>('/api/coherence', async (req, reply) => {
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));

    log.debug(`GET /api/coherence targetLang=${targetLang} limit=${limit} offset=${offset}`);

    const result = await getCoherenceGroups(db, targetLang, limit, offset);
    return reply.send(result);
  });

  // ── POST /api/coherence/resolve ───────────────────────────────────────────
  // Applies a single chosen translation to all strings in a coherence group
  // (i.e. all strings sharing the given text_norm) that currently carry a
  // *different* translation.  Strings that already use the chosen translation
  // are left untouched.
  //
  // Body (JSON):
  //   textNorm    — the normalised source text that identifies the group
  //   targetLang  — language code to update (default: 'uk')
  //   translation — the translation text to propagate to all strings in the group
  app.post<{
    Body: { textNorm: string; targetLang?: string; translation: string };
  }>('/api/coherence/resolve', async (req, reply) => {
    const { textNorm, translation } = req.body ?? {};
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;

    if (!textNorm || typeof textNorm !== 'string') {
      return reply.code(400).send({ error: 'textNorm is required' });
    }
    if (!translation || typeof translation !== 'string') {
      return reply.code(400).send({ error: 'translation is required' });
    }

    log.info(
      `POST /api/coherence/resolve targetLang=${targetLang} textNorm="${textNorm.slice(0, 60)}"`,
    );

    const result = await resolveCoherenceGroup(db, textNorm, targetLang, translation);
    return reply.send(result);
  });

  // ── POST /api/coherence/resolve-all ───────────────────────────────────────
  // Auto-resolves all inconsistency groups for the target language in one
  // pass by choosing the plurality-winner translation per group (the
  // translation used by the most strings; ties broken by status quality).
  //
  // Body (JSON):
  //   targetLang — language code to resolve (default: CONFIG.defaultTgtLang)
  app.post<{ Body: { targetLang?: string } }>('/api/coherence/resolve-all', async (req, reply) => {
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
    log.info(`POST /api/coherence/resolve-all targetLang=${targetLang}`);
    const result = await resolveAllCoherenceGroups(db, targetLang);
    return reply.send(result);
  });
};
