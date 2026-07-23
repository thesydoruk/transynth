import type { FastifyInstance } from 'fastify';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { NexusModsError, NexusModsNotFoundError } from '../../../nexus/index';
import { SUPPORTED_GAMES } from './catalogue';
import {
  fetchNexusModInfo,
  getNexus,
  mapRestModToView,
  sendNexusKeyMissing,
  type NexusModRequirementView,
} from './nexusClient';

export const registerNexusRelationsRoutes = async (app: FastifyInstance) => {
  /**
   * GET /api/games/:gameId/nexus/mod/:modId/relations[?count=<n>]
   *
   * Returns official Nexus relation lists for one mod:
   * - `requires`: dependencies required by this mod
   * - `requiredBy`: mods that depend on this mod
   *
   * For mods unavailable in GraphQL index, falls back to REST v1 for source
   * mod metadata and returns empty relation lists.
   */
  app.get<{
    Params: { gameId: string; modId: string };
    Querystring: { count?: string };
  }>('/api/games/:gameId/nexus/mod/:modId/relations', async (req, reply) => {
    const { gameId, modId: rawModId } = req.params;
    const { count: rawCount } = req.query;

    if (!CONFIG.nexusApiKey) return sendNexusKeyMissing(reply);

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const modId = parseInt(rawModId, 10);
    if (!Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "modId" must be a positive integer' });
    }

    const count = Math.min(200, Math.max(1, parseInt(rawCount ?? '100', 10) || 100));

    try {
      const result = await getNexus().getModRelations(game.domainName, game.nexusId, modId, {
        count,
      });

      const requires: NexusModRequirementView[] = result.requires;
      const requiredBy: NexusModRequirementView[] = result.requiredBy;

      return reply.send({
        sourceMod: result.sourceMod,
        requires,
        requiredBy,
      });
    } catch (err) {
      if (err instanceof NexusModsNotFoundError || err instanceof NexusModsError) {
        log.warn(`Nexus relations fallback for ${gameId}/${modId}: ${err.message}`);
        try {
          const rest = await fetchNexusModInfo(game.domainName, modId);
          const sourceMod = mapRestModToView(rest, game);
          return reply.send({
            sourceMod,
            requires: [],
            requiredBy: [],
          });
        } catch (fallbackErr) {
          if (fallbackErr instanceof NexusModsNotFoundError) {
            return reply.code(404).send({ error: fallbackErr.message });
          }
          const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          return reply.code(502).send({ error: msg });
        }
      }
      throw err;
    }
  });
};
