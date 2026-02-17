/**
 * games.ts — Supported games catalogue API.
 *
 * Endpoints:
 *   GET /api/games
 *     Returns the list of supported games with metadata.
 *
 *   GET /api/games/cover/:gameId
 *     Serves the game cover image (tile art).  On first request the image is
 *     fetched from the NexusMods static CDN (no API key required) and cached
 *     to `data/cache/games/<gameId>.jpg`.  Subsequent requests are served from
 *     the local cache.  If the CDN fetch fails, returns 404.
 *
 *   GET /api/games/:gameId/nexus/mods?q=<query>[&count=<n>]
 *     Searches NexusMods for mods belonging to the given game using the
 *     NexusMods GraphQL API v2.  Requires NEXUS_API_KEY in the environment.
 *
 *   GET /api/games/:gameId/nexus/translations?modId=<n>[&language=<lang>&count=<n>]
 *     Returns heuristically ranked translation candidates for a given mod.
 *     See NexusModsClient.findPossibleTranslations for the scoring model.
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../../logger.js';
import { createNexusClient, NexusModsNotFoundError, NexusModsError } from '../../nexus/index.js';
import { CONFIG } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the on-disk image cache directory.
 * Resolved relative to project root (`data/cache/games/`).
 */
const CACHE_DIR = path.resolve(__dirname, '../../../data/cache/games');

/** NexusMods 4:3 tile art base URL. */
const NM_TILE_BASE = 'https://staticdelivery.nexusmods.com/Images/games/4_3/tile_';

/* ── Game catalogue ─────────────────────────────────────────────────────── */

/**
 * Static catalogue of all games supported by the localization tool.
 *
 * `nexusId` is the numeric game ID used in the NexusMods CDN URL for cover art.
 * `releaseYear` is informational, shown in the tile subtitle.
 */
export interface GameInfo {
  /** Internal game identifier matching `GameType` in src/types.ts */
  id: string;
  /** Human-readable game title */
  name: string;
  /** Short developer/studio label */
  developer: string;
  /** Release year (informational, shown on the tile) */
  releaseYear: number;
  /** NexusMods numeric game ID — used to build the cover tile URL */
  nexusId: number;
  /**
   * NexusMods URL-safe domain name for this game (e.g. `"fallout4"`).
   * Used as the `gameDomainName` parameter in NexusMods GraphQL queries.
   */
  domainName: string;
  /** Engine family label shown as a tag on the tile */
  engine: string;
  /** Whether the game uses localized (external .STRINGS) plugins */
  localized: boolean;
}

export const SUPPORTED_GAMES: GameInfo[] = [
  {
    id: 'fo4',
    name: 'Fallout 4',
    developer: 'Bethesda Game Studios',
    releaseYear: 2015,
    nexusId: 1151,
    domainName: 'fallout4',
    engine: 'Creation Engine',
    localized: true,
  },
  {
    id: 'fo76',
    name: 'Fallout 76',
    developer: 'Bethesda Game Studios',
    releaseYear: 2018,
    nexusId: 2299,
    domainName: 'fallout76',
    engine: 'Creation Engine 2',
    localized: true,
  },
  {
    id: 'fo3',
    name: 'Fallout 3',
    developer: 'Bethesda Game Studios',
    releaseYear: 2008,
    nexusId: 120,
    domainName: 'fallout3',
    engine: 'Gamebryo',
    localized: false,
  },
  {
    id: 'fnv',
    name: 'Fallout: New Vegas',
    developer: 'Obsidian Entertainment',
    releaseYear: 2010,
    nexusId: 130,
    domainName: 'newvegas',
    engine: 'Gamebryo',
    localized: false,
  },
  {
    id: 'sse',
    name: 'Skyrim Special Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2016,
    nexusId: 1704,
    domainName: 'skyrimspecialedition',
    engine: 'Creation Engine',
    localized: true,
  },
  {
    id: 'sle',
    name: 'Skyrim Legendary Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2013,
    nexusId: 110,
    domainName: 'skyrim',
    engine: 'Gamebryo/Creation Engine',
    localized: true,
  },
];

/**
 * Lazily-initialised singleton NexusMods client.
 *
 * A single instance is reused across all requests to avoid re-reading the
 * config and re-creating the HTTP headers on every call.  The instance is
 * created only when the first NexusMods-backed endpoint is hit, so startup
 * is not affected when no NexusMods calls are made.
 *
 * Initialisation is deferred rather than done at module load time so that
 * config (including NEXUS_API_KEY) is guaranteed to be resolved first.
 */
let _nexus: ReturnType<typeof createNexusClient> | null = null;

const getNexus = () => {
  _nexus ??= createNexusClient();
  return _nexus;
};

/* ── Route registration ─────────────────────────────────────────────────── */

export const gamesRoutes = async (app: FastifyInstance) => {
  /**
   * GET /api/games
   *
   * Returns the full SUPPORTED_GAMES catalogue as JSON.
   * No database queries — pure static data.
   */
  app.get('/api/games', async (_req, reply) => {
    return reply.send(SUPPORTED_GAMES);
  });

  /**
   * GET /api/games/cover/:gameId
   *
   * Serves the NexusMods tile image for the given game.
   *
   * Flow:
   *   1. Check for `data/cache/games/<gameId>.jpg` — if exists, pipe it.
   *   2. Otherwise fetch from NexusMods CDN, save to cache, then pipe.
   *   3. If CDN unreachable or game unknown → 404.
   *
   * Security: gameId is validated against the known game list to prevent
   * path traversal. Only alphanumeric / underscore game IDs are accepted.
   */
  app.get<{ Params: { gameId: string } }>('/api/games/cover/:gameId', async (req, reply) => {
    const { gameId } = req.params;

    // Validate: only known game IDs (prevents path traversal)
    const game = SUPPORTED_GAMES.find(g => g.id === gameId);
    if (!game) {
      return reply.code(404).send({ error: 'Unknown game' });
    }

    const cachePath = path.join(CACHE_DIR, `${gameId}.jpg`);

    // Ensure cache directory exists
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // Serve from disk cache if available
    if (fs.existsSync(cachePath)) {
      const stream = fs.createReadStream(cachePath);
      reply.type('image/jpeg');
      return reply.send(stream);
    }

    // First request — fetch from NexusMods CDN and cache
    const url = `${NM_TILE_BASE}${game.nexusId}.jpg`;
    log.info(`Fetching game cover for ${gameId} from ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.warn(`NexusMods CDN returned ${res.status} for game ${gameId}`);
        return reply.code(404).send({ error: 'Cover not available' });
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      // Persist to cache asynchronously (don't await — serve immediately)
      fs.writeFile(cachePath, buffer, (err) => {
        if (err) log.warn(`Failed to cache cover for ${gameId}: ${err.message}`);
        else log.info(`Cached game cover: ${cachePath}`);
      });

      reply.type('image/jpeg');
      return reply.send(buffer);
    } catch (err) {
      log.warn(`Failed to fetch cover for ${gameId}: ${String(err)}`);
      return reply.code(502).send({ error: 'Failed to fetch cover image' });
    }
  });

  /* ── NexusMods GraphQL endpoints ────────────────────────────────────── */

  /**
   * GET /api/games/:gameId/nexus/mods?q=<query>[&count=<n>]
   *
   * Searches the NexusMods catalogue for mods belonging to the given game.
   * Results are ordered by last-updated date (newest first).
   *
   * Query parameters:
   *   q      {string}  — required, the search query (mod title / keywords)
   *   count  {number}  — optional, page size, default 20, max 50
   *
   * Requires NEXUS_API_KEY to be set in the environment.  Returns 503 when
   * the key is absent or 502 when the upstream API is unreachable.
   */
  app.get<{
    Params: { gameId: string };
    Querystring: { q?: string; count?: string };
  }>('/api/games/:gameId/nexus/mods', async (req, reply) => {
    const { gameId } = req.params;
    const { q, count: rawCount } = req.query;

    if (!CONFIG.nexusApiKey) {
      return reply.code(503).send({ error: 'NEXUS_API_KEY is not configured on the server' });
    }

    // Validate game
    const game = SUPPORTED_GAMES.find(g => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    // Validate query
    if (!q || !q.trim()) {
      return reply.code(400).send({ error: 'Query parameter "q" is required' });
    }

    // Clamp count to a reasonable range
    const count = Math.min(50, Math.max(1, parseInt(rawCount ?? '20', 10) || 20));

    try {
      const result = await getNexus().searchModsByName(q, {
        gameDomainName: game.domainName,
        count,
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

  /**
   * GET /api/games/:gameId/nexus/translations?modId=<n>[&language=<lang>&count=<n>]
   *
   * Finds heuristically ranked translation candidates for a given mod.
   * The source mod is fetched first, then candidates are scored based on
   * title overlap, translation keywords, and optional language match.
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

    if (!CONFIG.nexusApiKey) {
      return reply.code(503).send({ error: 'NEXUS_API_KEY is not configured on the server' });
    }

    // Validate game
    const game = SUPPORTED_GAMES.find(g => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    // Validate modId
    const modId = parseInt(rawModId ?? '', 10);
    if (!rawModId || !Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Query parameter "modId" must be a positive integer' });
    }

    const count = Math.min(100, Math.max(1, parseInt(rawCount ?? '50', 10) || 50));

    try {
      const result = await getNexus().findPossibleTranslations(game.domainName, modId, {
        language: language?.trim() || undefined,
        count,
        includeDescriptionSearch: true,
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof NexusModsNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      if (err instanceof NexusModsError) {
        log.warn(`NexusMods translation search failed for ${gameId}/${modId}: ${err.message}`);
        return reply.code(502).send({ error: err.message });
      }
      throw err;
    }
  });
};
