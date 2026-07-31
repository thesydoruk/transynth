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
 * "Coherence" means that all source strings with the same exact text and
 * record signature should be translated the same way. UI vs dialog (and other
 * GRUPs) are separate groups. Endpoints expose a paginated report and resolve
 * actions.
 */
export const coherenceRoutes = async (app: FastifyInstance, db: Tx) => {
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

  // Body:
  //   sourceText  — exact source text that identifies the group
  //   signature   — record signature (GRUP) scoped with sourceText
  //   targetLang  — language code to update (default: CONFIG.defaultTgtLang)
  //   translation — the translation text to propagate
  // Legacy alias: textNorm is accepted as sourceText for older clients.
  app.post<{
    Body: {
      sourceText?: string;
      textNorm?: string;
      signature?: string;
      targetLang?: string;
      translation: string;
    };
  }>('/api/coherence/resolve', async (req, reply) => {
    const sourceText = req.body?.sourceText ?? req.body?.textNorm;
    const { translation } = req.body ?? {};
    const signature = req.body?.signature;
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;

    if (!sourceText || typeof sourceText !== 'string') {
      return reply.code(400).send({ error: 'sourceText is required' });
    }
    if (typeof signature !== 'string') {
      return reply.code(400).send({ error: 'signature is required' });
    }
    if (!translation || typeof translation !== 'string') {
      return reply.code(400).send({ error: 'translation is required' });
    }

    log.info(
      `POST /api/coherence/resolve targetLang=${targetLang} signature=${signature} sourceText="${sourceText.slice(0, 60)}"`,
    );

    const result = await resolveCoherenceGroup(db, sourceText, signature, targetLang, translation);
    return reply.send(result);
  });

  app.post<{ Body: { targetLang?: string } }>('/api/coherence/resolve-all', async (req, reply) => {
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
    log.info(`POST /api/coherence/resolve-all targetLang=${targetLang}`);
    const result = await resolveAllCoherenceGroups(db, targetLang);
    return reply.send(result);
  });
};
