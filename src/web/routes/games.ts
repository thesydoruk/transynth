/**
 * games.ts — Supported games catalogue API.
 *
 * Endpoints:
 *   GET /api/games          — returns the list of supported games with metadata.
 *   GET /api/games/cover/:gameId — serves the game cover image (tile art).
 *       On first request the image is fetched from NexusMods CDN and cached
 *       to `data/cache/games/<gameId>.jpg` on disk.  Subsequent requests are
 *       served from the local cache.  If the CDN fetch fails a 404 is returned.
 *
 * The NexusMods static CDN does not require an API key for cover tile images.
 * URL pattern: https://staticdelivery.nexusmods.com/Images/games/4_3/tile_<nexusId>.jpg
 */

import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../../logger.js';

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
    engine: 'Creation Engine',
    localized: true,
  },
  {
    id: 'fo76',
    name: 'Fallout 76',
    developer: 'Bethesda Game Studios',
    releaseYear: 2018,
    nexusId: 2299,
    engine: 'Creation Engine 2',
    localized: true,
  },
  {
    id: 'fo3',
    name: 'Fallout 3',
    developer: 'Bethesda Game Studios',
    releaseYear: 2008,
    nexusId: 120,
    engine: 'Gamebryo',
    localized: false,
  },
  {
    id: 'fnv',
    name: 'Fallout: New Vegas',
    developer: 'Obsidian Entertainment',
    releaseYear: 2010,
    nexusId: 130,
    engine: 'Gamebryo',
    localized: false,
  },
  {
    id: 'sse',
    name: 'Skyrim Special Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2016,
    nexusId: 1704,
    engine: 'Creation Engine',
    localized: true,
  },
  {
    id: 'sle',
    name: 'Skyrim Legendary Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2013,
    nexusId: 110,
    engine: 'Gamebryo/Creation Engine',
    localized: true,
  },
];

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
};
