import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { searchReplaceTranslations } from '../queries';
import { log } from '../../logger';
import { CONFIG } from '../../config';

export const searchRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:id/search-replace
  // body: { search, replace, isRegex?, targetLang?, dryRun? }
  // dryRun=true → returns matches without applying, dryRun=false (default) → applies changes
  app.post<{
    Params: { id: string };
    Body: {
      search: string;
      replace: string;
      isRegex?: boolean;
      targetLang?: string;
      dryRun?: boolean;
    };
  }>('/api/mods/:id/search-replace', async (req, reply) => {
    const modId = Number(req.params.id);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }

    const { search, replace, isRegex = false, targetLang = CONFIG.defaultTgtLang, dryRun = false } = req.body ?? {};

    if (typeof search !== 'string' || search.trim() === '') {
      return reply.code(400).send({ error: 'search is required' });
    }
    if (typeof replace !== 'string') {
      return reply.code(400).send({ error: 'replace is required' });
    }

    try {
      log.info(`POST /api/mods/${modId}/search-replace search="${search}" replace="${replace}" regex=${isRegex} dryRun=${dryRun}`);
      const result = await searchReplaceTranslations(
        db,
        modId,
        search,
        replace,
        isRegex,
        targetLang,
        dryRun,
      );
      return reply.send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`search-replace error: ${message}`);
      return reply.code(400).send({ error: message });
    }
  });
}
