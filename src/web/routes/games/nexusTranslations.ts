import type { FastifyInstance } from 'fastify';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { NexusModsError, NexusModsNotFoundError } from '../../../nexus/index';
import { SUPPORTED_GAMES } from './catalogue';
import { fetchNexusModInfo, getNexus, mapRestModToView, sendNexusKeyMissing } from './nexusClient';

export const registerNexusTranslationsRoutes = async (app: FastifyInstance) => {
  /**
   * GET /api/games/:gameId/nexus/translations?modId=<n>[&language=<lang>&count=<n>]
   *
   * Finds heuristically ranked translation candidates for a given mod.
   *
   * Path parameters:
   *   gameId   {string} — internal game ID (e.g. "fo4")
   *
   * Query parameters:
   *   modId    {number} — required, the NexusMods public mod ID of the source mod
   *   language {string} — optional, language name (e.g. "ukrainian", "russian")
   *   count    {number} — optional, max raw candidates to fetch, default 50, max 100
   *
   * Returns 404 when the source mod does not exist on NexusMods.
   * Returns 400 when modId is missing or non-numeric.
   * Returns 502 on NexusMods API errors.
   */
  app.get<{
    Params: { gameId: string };
    Querystring: { modId?: string; language?: string; count?: string };
  }>('/api/games/:gameId/nexus/translations', async (req, reply) => {
    const { gameId } = req.params;
    const { modId: rawModId, language, count: rawCount } = req.query;

    if (!CONFIG.nexusApiKey) return sendNexusKeyMissing(reply);

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const modId = parseInt(rawModId ?? '', 10);
    if (!rawModId || !Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Query parameter "modId" must be a positive integer' });
    }

    const count = Math.min(100, Math.max(1, parseInt(rawCount ?? '50', 10) || 50));

    try {
      const result = await getNexus().findPossibleTranslations(
        game.domainName,
        game.nexusId,
        modId,
        {
          language: language?.trim() || undefined,
          count,
          includeDescriptionSearch: true,
        },
      );

      return reply.send(result);
    } catch (err) {
      if (err instanceof NexusModsNotFoundError || err instanceof NexusModsError) {
        log.warn(`NexusMods translation fallback for ${gameId}/${modId}: ${err.message}`);
        try {
          const rest = await fetchNexusModInfo(game.domainName, modId);
          const sourceMod = mapRestModToView(rest, game);
          return reply.send({
            sourceMod,
            totalCount: 0,
            nodesCount: 0,
            items: [],
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
