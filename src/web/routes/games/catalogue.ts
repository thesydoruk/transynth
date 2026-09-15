import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { GameEditorCapabilities } from '../../../games/contract';
import { allGamePlugins, findGamePlugin } from '../../../games/registry';
import { log } from '../../../logger';
import { PATHS } from '../../../paths';

const CACHE_DIR = PATHS.gamesCache;

/** Browser cache TTL for game covers (7 days). */
const COVER_CACHE_SECONDS = 60 * 60 * 24 * 7;
/**
 * Catalogue JSON must revalidate on every request after deploys add/remove games.
 * ETag still allows cheap 304s; max-age would hide new titles for up to an hour.
 */
const GAMES_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/** NexusMods 4:3 tile art base URL. */
const NM_TILE_BASE = 'https://staticdelivery.nexusmods.com/Images/games/4_3/tile_';

/**
 * One game as the browser sees it: the catalogue tile plus the editor profile
 * that decides which tabs, columns, and actions that game's mods get.
 *
 * Everything here comes from the game's plugin, so a new title appears in the
 * UI without a single change in `web-ui`.
 */
export interface GameInfo {
  id: string;
  name: string;
  developer: string;
  releaseYear: number;
  engine: string;
  /** Whether the game keeps its text in external string tables. */
  localized: boolean;
  /** NexusMods numeric game id — used to build the cover tile URL. Absent when unlisted. */
  nexusId?: number;
  /** NexusMods url-safe domain, used as `gameDomainName` in GraphQL queries. */
  domainName?: string;
  /** File extensions this game accepts as a direct upload, alongside archives. */
  uploadExtensions: string[];
  editor: GameEditorCapabilities;
}

const gameInfo = (id: string): GameInfo => {
  const plugin = findGamePlugin(id)!;
  const { catalogue } = plugin;
  return {
    id: catalogue.id,
    name: catalogue.name,
    developer: catalogue.developer,
    releaseYear: catalogue.releaseYear,
    engine: catalogue.engine,
    localized: catalogue.localized,
    uploadExtensions: [...plugin.import.uploadExtensions],
    nexusId: catalogue.nexus?.id,
    domainName: catalogue.nexus?.domain,
    editor: plugin.editor,
  };
};

/** The catalogue served to the browser, in plugin registration order. */
const supportedGames = (): GameInfo[] => allGamePlugins().map((plugin) => gameInfo(plugin.id));

/** One game's catalogue entry, or null when the id is not registered. */
export const findSupportedGame = (gameId: string): GameInfo | null =>
  findGamePlugin(gameId) ? gameInfo(gameId) : null;

/** Stable ETag for the static games catalogue payload. */
const gamesEtag = (): string =>
  `"${crypto.createHash('sha1').update(JSON.stringify(supportedGames())).digest('hex')}"`;

/** Builds a weak ETag from file size and mtime. */
const buildWeakEtag = (size: number, mtimeMs: number): string =>
  `W/"${size}-${Math.trunc(mtimeMs)}"`;

export const registerCatalogueRoutes = async (app: FastifyInstance) => {
  const etag = gamesEtag();

  /**
   * GET /api/games
   *
   * The registered game plugins as JSON. No database queries.
   */
  app.get('/api/games', async (req, reply) => {
    if (req.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }

    reply.header('Cache-Control', GAMES_CACHE_CONTROL);
    reply.header('ETag', etag);
    return reply.send(supportedGames());
  });

  /**
   * GET /api/games/cover/:gameId
   *
   * Serves the NexusMods tile image for the given game.
   *
   * Flow:
   *   1. Check for `data/cache/games/<gameId>.jpg` — if it exists, pipe it.
   *   2. Otherwise fetch from the NexusMods CDN, cache it, then pipe.
   *   3. If the CDN is unreachable or the game is unknown → 404.
   *
   * Security: gameId is validated against the registry before it is used in a
   * path, so it can never escape the cache directory.
   */
  app.get<{ Params: { gameId: string } }>('/api/games/cover/:gameId', async (req, reply) => {
    const { gameId } = req.params;

    const game = findSupportedGame(gameId);
    if (!game?.nexusId) {
      return reply.code(404).send({ error: 'Unknown game' });
    }

    const cachePath = path.join(CACHE_DIR, `${game.id}.jpg`);

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const coverEtag = buildWeakEtag(stat.size, stat.mtimeMs);

      if (req.headers['if-none-match'] === coverEtag) {
        return reply.code(304).send();
      }

      const stream = fs.createReadStream(cachePath);
      reply.header(
        'Cache-Control',
        `public, max-age=${COVER_CACHE_SECONDS}, stale-while-revalidate=86400`,
      );
      reply.header('ETag', coverEtag);
      reply.type('image/jpeg');
      return reply.send(stream);
    }

    const url = `${NM_TILE_BASE}${game.nexusId}.jpg`;
    log.info(`Fetching game cover for ${game.id} from ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.warn(`NexusMods CDN returned ${res.status} for game ${game.id}`);
        return reply.code(404).send({ error: 'Cover not available' });
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const coverEtag = buildWeakEtag(buffer.length, Date.now());

      fs.writeFile(cachePath, buffer, (err) => {
        if (err) log.warn(`Failed to cache cover for ${game.id}: ${err.message}`);
        else log.info(`Cached game cover: ${cachePath}`);
      });

      reply.header(
        'Cache-Control',
        `public, max-age=${COVER_CACHE_SECONDS}, stale-while-revalidate=86400`,
      );
      reply.header('ETag', coverEtag);
      reply.type('image/jpeg');
      return reply.send(buffer);
    } catch (err) {
      log.warn(`Failed to fetch cover for ${game.id}: ${String(err)}`);
      return reply.code(502).send({ error: 'Failed to fetch cover image' });
    }
  });
};
