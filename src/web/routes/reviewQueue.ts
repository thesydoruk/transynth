import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { log } from '../../logger.js';
import { listReviewQueue } from '../queries.js';
import { CONFIG } from '../../config.js';

/** Comma-separated statuses that are valid for the review queue filter. */
const VALID_STATUSES = new Set(['auto', 'draft', 'fuzzy', 'tm', 'human', 'reviewed', 'rejected']);

/** Default statuses included when the caller does not specify any. */
const DEFAULT_STATUSES = ['auto', 'fuzzy', 'tm', 'draft'];

/**
 * Review queue route — GET /api/review-queue.
 *
 * Returns a paginated, cross-mod list of translations that are in statuses
 * requiring human review (auto, fuzzy, tm, draft by default), sorted by
 * confidence ascending so the least-certain strings surface first.
 *
 * Query parameters:
 *   targetLang     — language code to inspect (default: 'uk')
 *   statuses       — comma-separated list of statuses to include
 *                    (default: 'auto,fuzzy,tm,draft')
 *   modId          — optional integer; limit results to one mod
 *   maxConfidence  — optional float [0–1]; exclude strings above this confidence
 *   page           — 1-based page number (default: 1)
 *   pageSize       — rows per page (default: 50, max: 200)
 */
export const reviewQueueRoutes = async (app: FastifyInstance, db: Tx) => {
  app.get<{
    Querystring: {
      targetLang?: string;
      statuses?: string;
      modId?: string;
      maxConfidence?: string;
      page?: string;
      pageSize?: string;
    };
  }>('/api/review-queue', async (req, reply) => {
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

    // Parse and validate statuses (comma-separated, fall back to defaults)
    const rawStatuses = req.query.statuses
      ? req.query.statuses.split(',').map((s) => s.trim()).filter((s) => VALID_STATUSES.has(s))
      : DEFAULT_STATUSES;
    const statuses = rawStatuses.length > 0 ? rawStatuses : DEFAULT_STATUSES;

    // Optional mod filter
    const rawModId = req.query.modId ? Number(req.query.modId) : null;
    const modId = rawModId !== null && !isNaN(rawModId) && rawModId > 0 ? rawModId : null;

    // Optional confidence ceiling (strings with confidence > this are excluded)
    const rawMaxConf = req.query.maxConfidence !== undefined ? Number(req.query.maxConfidence) : null;
    const maxConfidence =
      rawMaxConf !== null && !isNaN(rawMaxConf) && rawMaxConf >= 0 && rawMaxConf < 1
        ? rawMaxConf
        : null;

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));

    log.debug(
      `GET /api/review-queue targetLang=${targetLang} statuses=[${statuses}] modId=${modId} maxConf=${maxConfidence} page=${page} pageSize=${pageSize}`,
    );

    const result = await listReviewQueue(db, targetLang, statuses, modId, maxConfidence, page, pageSize);
    return reply.send(result);
  });
};
