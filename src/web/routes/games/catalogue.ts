import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { log } from '../../../logger';
import { PATHS } from '../../../paths';

const CACHE_DIR = PATHS.gamesCache;

/** Browser cache TTL for game covers (7 days). */
const COVER_CACHE_SECONDS = 60 * 60 * 24 * 7;
/** Browser cache TTL for games catalogue JSON (1 hour). */
const GAMES_CACHE_SECONDS = 60 * 60;

/** NexusMods 4:3 tile art base URL. */
const NM_TILE_BASE = 'https://staticdelivery.nexusmods.com/Images/games/4_3/tile_';

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
    id: 'ob',
    name: 'The Elder Scrolls IV: Oblivion',
    developer: 'Bethesda Game Studios',
    releaseYear: 2006,
    nexusId: 101,
    domainName: 'oblivion',
    engine: 'Gamebryo',
    localized: false,
  },
  {
    id: 'mw',
    name: 'The Elder Scrolls III: Morrowind',
    developer: 'Bethesda Game Studios',
    releaseYear: 2002,
    nexusId: 100,
    domainName: 'morrowind',
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

/** Stable ETag for the static games catalogue payload. */
const GAMES_ETAG = `"${crypto.createHash('sha1').update(JSON.stringify(SUPPORTED_GAMES)).digest('hex')}"`;

/** Builds a weak ETag from file size and mtime. */
const buildWeakEtag = (size: number, mtimeMs: number): string =>
  `W/"${size}-${Math.trunc(mtimeMs)}"`;

export const registerCatalogueRoutes = async (app: FastifyInstance) => {
  /**
   * GET /api/games
   *
   * Returns the full SUPPORTED_GAMES catalogue as JSON.
   * No database queries — pure static data.
   */
  app.get('/api/games', async (req, reply) => {
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === GAMES_ETAG) {
      return reply.code(304).send();
    }

    reply.header('Cache-Control', `public, max-age=${GAMES_CACHE_SECONDS}`);
    reply.header('ETag', GAMES_ETAG);
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

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) {
      return reply.code(404).send({ error: 'Unknown game' });
    }

    const cachePath = path.join(CACHE_DIR, `${gameId}.jpg`);

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const etag = buildWeakEtag(stat.size, stat.mtimeMs);

      if (req.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }

      const stream = fs.createReadStream(cachePath);
      reply.header(
        'Cache-Control',
        `public, max-age=${COVER_CACHE_SECONDS}, stale-while-revalidate=86400`,
      );
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      return reply.send(stream);
    }

    const url = `${NM_TILE_BASE}${game.nexusId}.jpg`;
    log.info(`Fetching game cover for ${gameId} from ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.warn(`NexusMods CDN returned ${res.status} for game ${gameId}`);
        return reply.code(404).send({ error: 'Cover not available' });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const etag = buildWeakEtag(buffer.length, Date.now());

      fs.writeFile(cachePath, buffer, (err) => {
        if (err) log.warn(`Failed to cache cover for ${gameId}: ${err.message}`);
        else log.info(`Cached game cover: ${cachePath}`);
      });

      reply.header(
        'Cache-Control',
        `public, max-age=${COVER_CACHE_SECONDS}, stale-while-revalidate=86400`,
      );
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      return reply.send(buffer);
    } catch (err) {
      log.warn(`Failed to fetch cover for ${gameId}: ${String(err)}`);
      return reply.code(502).send({ error: 'Failed to fetch cover image' });
    }
  });
};
