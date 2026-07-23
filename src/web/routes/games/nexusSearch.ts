import type { FastifyInstance } from 'fastify';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { NexusModsError } from '../../../nexus/index';
import { SUPPORTED_GAMES } from './catalogue';
import { getNexus, sendNexusKeyMissing } from './nexusClient';

export const registerNexusSearchRoutes = async (app: FastifyInstance) => {
  /**
   * GET /api/games/:gameId/nexus/mods[?q=<query>&count=<n>&offset=<n>]
   *
   * Searches the NexusMods catalogue for mods belonging to the given game.
   * Results are ordered by last-updated date (newest first).
   *
   * Query parameters:
   *   q      {string}  — optional, the search query (mod title / keywords)
   *   count  {number}  — optional, page size, default 20, max 50
   *   offset {number}  — optional, zero-based offset, default 0
   *
   * Requires NEXUS_API_KEY to be set in the environment.  Returns 503 when
   * the key is absent or 502 when the upstream API is unreachable.
   */
  app.get<{
    Params: { gameId: string };
    Querystring: { q?: string; count?: string; offset?: string };
  }>('/api/games/:gameId/nexus/mods', async (req, reply) => {
    const { gameId } = req.params;
    const { q, count: rawCount, offset: rawOffset } = req.query;

    if (!CONFIG.nexusApiKey) return sendNexusKeyMissing(reply);

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const count = Math.min(50, Math.max(1, parseInt(rawCount ?? '20', 10) || 20));
    const offset = Math.max(0, parseInt(rawOffset ?? '0', 10) || 0);

    try {
      const result = await getNexus().searchModsByName(q?.trim() ?? '', {
        gameDomainName: game.domainName,
        count,
        offset,
        useStemmedSearch: true,
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof NexusModsError) {
        log.warn(`NexusMods mod search failed for ${gameId}: ${err.message}`);
        return reply.code(502).send({ error: `NexusMods search failed: ${err.message}` });
      }
      throw err;
    }
  });
};
