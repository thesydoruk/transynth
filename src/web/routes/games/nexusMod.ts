import type { FastifyInstance } from 'fastify';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { NexusModsError, NexusModsNotFoundError } from '../../../nexus/index';
import { SUPPORTED_GAMES } from './catalogue';
import {
  fetchNexusModFiles,
  fetchNexusModInfo,
  getNexus,
  mapRestModToView,
  sendNexusKeyMissing,
  type NexusModView,
} from './nexusClient';

export const registerNexusModRoutes = async (app: FastifyInstance) => {
  /**
   * GET /api/games/:gameId/nexus/mod/:modId
   *
   * Returns a compound payload for a single Nexus mod:
   * - `mod`: full mod metadata from GraphQL v2
   * - `files`: attached file list from REST v1
   *
   * This endpoint powers the mod details page where users review metadata
   * and attached archives/files before choosing translation candidates.
   */
  app.get<{
    Params: { gameId: string; modId: string };
  }>('/api/games/:gameId/nexus/mod/:modId', async (req, reply) => {
    const { gameId, modId: rawModId } = req.params;

    if (!CONFIG.nexusApiKey) return sendNexusKeyMissing(reply);

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const modId = parseInt(rawModId, 10);
    if (!Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "modId" must be a positive integer' });
    }

    try {
      let mod: NexusModView;
      try {
        mod = (await getNexus().getModById(game.domainName, game.nexusId, modId)) as NexusModView;
      } catch (err) {
        if (err instanceof NexusModsNotFoundError || err instanceof NexusModsError) {
          log.warn(
            `Nexus GraphQL mod lookup fallback to REST for ${gameId}/${modId}: ${err.message}`,
          );
          const rest = await fetchNexusModInfo(game.domainName, modId);
          mod = mapRestModToView(rest, game);
        } else {
          throw err;
        }
      }

      const files = await fetchNexusModFiles(game.domainName, modId);
      return reply.send({ mod, files });
    } catch (err) {
      if (err instanceof NexusModsNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      if (err instanceof Error) {
        log.warn(`Nexus mod details failed for ${gameId}/${modId}: ${err.message}`);
        return reply.code(502).send({ error: `Nexus mod details failed: ${err.message}` });
      }
      throw err;
    }
  });
};
