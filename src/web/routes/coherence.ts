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
    Querystring: { targetLang?: string; limit?: string; offset?: string; game?: string };
  }>('/api/coherence', async (req, reply) => {
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const game = req.query.game || undefined;

    log.debug(
      `GET /api/coherence targetLang=${targetLang} game=${game ?? 'all'} limit=${limit} offset=${offset}`,
    );

    const result = await getCoherenceGroups(db, targetLang, limit, offset, undefined, game);
    return reply.send(result);
  });

  // Body:
  //   sourceText  — exact source text that identifies the group
  //   signature   — record signature (GRUP) scoped with sourceText
  //   targetLang  — language code to update (default: CONFIG.defaultTgtLang)
  //   translation — the translation text to propagate
  app.post<{
    Body: {
      sourceText?: string;
      signature?: string;
      targetLang?: string;
      translation: string;
      game?: string;
    };
  }>('/api/coherence/resolve', async (req, reply) => {
    const sourceText = req.body?.sourceText;
    const { translation } = req.body ?? {};
    const signature = req.body?.signature;
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
    const game = req.body?.game || undefined;

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

    const result = await resolveCoherenceGroup(
      db,
      sourceText,
      signature,
      targetLang,
      translation,
      undefined,
      game,
    );
    return reply.send(result);
  });

  app.post<{ Body: { targetLang?: string; game?: string } }>(
    '/api/coherence/resolve-all',
    async (req, reply) => {
      const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
      const game = req.body?.game || undefined;
      log.info(`POST /api/coherence/resolve-all targetLang=${targetLang} game=${game ?? 'all'}`);
      const result = await resolveAllCoherenceGroups(db, targetLang, undefined, game);
      return reply.send(result);
    },
  );
};
