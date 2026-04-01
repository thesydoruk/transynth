import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { listInnrGroups } from '../queries';
import { CONFIG } from '../../config';

/**
 * INNR editor routes.
 *
 * Provides a grouped view of Instance Naming Rule (INNR) records for a single
 * mod.  INNR records define how the game assembles compound item names from
 * component parts (material, quality, item type, etc.).  The translator must
 * see all of a naming rule's component slots together to maintain grammatical
 * agreement between parts.
 */
export const innrRoutes = async (app: FastifyInstance, db: Tx) => {
  /**
   * GET /api/mods/:modId/innr
   *
   * Returns all INNR strings for a single mod, grouped by base EDID prefix.
   *
   * Path parameters:
   *   modId      — numeric mod ID
   *
   * Query parameters:
   *   targetLang — language code for translations (default: 'uk')
   *   srcLang    — source language code (default: 'en')
   */
  app.get<{
    Params: { modId: string };
    Querystring: { targetLang?: string; srcLang?: string };
  }>('/api/mods/:modId/innr', async (req, reply) => {
    const modId = parseInt(req.params.modId, 10);
    if (isNaN(modId)) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;

    const result = await listInnrGroups(db, modId, targetLang, srcLang);
    return reply.send(result);
  });
};
