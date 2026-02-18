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

/**
 * A single Nexus file attachment returned by v1 files endpoint.
 *
 * We intentionally normalize only the fields needed by the UI and keep the
 * shape stable regardless of minor upstream response changes.
 */
interface NexusFileAttachment {
  fileId: number;
  name: string;
  version: string | null;
  categoryName: string | null;
  isPrimary: boolean;
  uploadedTime: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  description: string | null;
}

/**
 * Minimal normalized shape for a Nexus mod object returned to the frontend.
 *
 * This matches the frontend `NexusModItem` contract used on the mod details
 * and likely-translations pages.
 */
interface NexusModView {
  id: number;
  modId: number;
  uid: string;
  name: string;
  summary: string;
  description: string;
  version: string;
  category: string;
  status: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  downloads: number;
  endorsements: number;
  adultContent: boolean | null;
  pictureUrl: string | null;
  thumbnailUrl: string | null;
  gameId: number;
  game: {
    id: number;
    name: string;
    domainName: string;
    genre: string | null;
    forumUrl: string | null;
    modCount: number | null;
    downloadCount: string | null;
    uniqueDownloadCount: string | null;
  };
  uploader: { memberId: number | null; name: string } | null;
  tags: string[];
}

/**
 * Fetches a single mod from Nexus REST v1 endpoint.
 *
 * Endpoint:
 *   GET https://api.nexusmods.com/v1/games/:domain/mods/:modId.json
 */
const fetchNexusModInfo = async (
  domainName: string,
  modId: number,
): Promise<Record<string, unknown>> => {
  const key = CONFIG.nexusApiKey;
  if (!key) {
    throw new Error('NEXUS_API_KEY is not configured on the server');
  }

  const url = `https://api.nexusmods.com/v1/games/${domainName}/mods/${modId}.json`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      'User-Agent': 'storywealth-localizer/1.0',
    },
  });

  if (res.status === 404) {
    throw new NexusModsNotFoundError(`Mod "${domainName}/${modId}" was not found.`);
  }
  if (!res.ok) {
    throw new Error(`Nexus mod info API returned HTTP ${res.status}`);
  }

  return (await res.json()) as Record<string, unknown>;
};

/**
 * Maps REST v1 mod payload into the frontend-facing normalized shape.
 */
const mapRestModToView = (
  raw: Record<string, unknown>,
  game: GameInfo,
): NexusModView => {
  const n = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const sn = (v: unknown): string | null => {
    const value = s(v).trim();
    return value ? value : null;
  };

  const user = (raw.user ?? null) as Record<string, unknown> | null;
  const memberId = user ? n(user.member_id) : 0;

  return {
    id: n(raw.uid) || n(raw.mod_id),
    modId: n(raw.mod_id),
    uid: String(raw.uid ?? raw.mod_id ?? ''),
    name: s(raw.name),
    summary: s(raw.summary),
    description: s(raw.description),
    version: s(raw.version),
    category: String(raw.category_id ?? ''),
    status: s(raw.status),
    author: sn(raw.author),
    createdAt: s(raw.created_time),
    updatedAt: s(raw.updated_time),
    downloads: n(raw.mod_downloads),
    endorsements: n(raw.endorsement_count),
    adultContent: typeof raw.contains_adult_content === 'boolean' ? raw.contains_adult_content : null,
    pictureUrl: sn(raw.picture_url),
    thumbnailUrl: sn(raw.picture_url),
    gameId: game.nexusId,
    game: {
      id: game.nexusId,
      name: game.name,
      domainName: game.domainName,
      genre: null,
      forumUrl: null,
      modCount: null,
      downloadCount: null,
      uniqueDownloadCount: null,
    },
    uploader: {
      memberId: memberId || null,
      name: s(raw.uploaded_by) || s(raw.author),
    },
    tags: [],
  };
};

/**
 * Fetches the attached file list for a Nexus mod using the REST v1 endpoint.
 *
 * Endpoint:
 *   GET https://api.nexusmods.com/v1/games/:domain/mods/:modId/files.json
 *
 * Auth:
 *   Header `apikey: <NEXUS_API_KEY>`
 *
 * @param domainName - Nexus game domain name, e.g. `fallout4`
 * @param modId - Nexus public mod ID
 * @returns Normalized file attachments array (possibly empty)
 */
const fetchNexusModFiles = async (
  domainName: string,
  modId: number,
): Promise<NexusFileAttachment[]> => {
  const key = CONFIG.nexusApiKey;
  if (!key) {
    throw new Error('NEXUS_API_KEY is not configured on the server');
  }

  const url = `https://api.nexusmods.com/v1/games/${domainName}/mods/${modId}/files.json`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      'User-Agent': 'storywealth-localizer/1.0',
    },
  });

  if (!res.ok) {
    throw new Error(`Nexus files API returned HTTP ${res.status}`);
  }

  const json = await res.json() as { files?: unknown[] };
  const files = Array.isArray(json.files) ? json.files : [];

  return files.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const n = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim()) {
        const parsed = Number(v);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

    return {
      fileId: n(row.file_id) ?? 0,
      name: s(row.name) ?? 'Unnamed file',
      version: s(row.version),
      categoryName: s(row.category_name),
      isPrimary: row.is_primary === true,
      uploadedTime: s(row.uploaded_time),
      sizeBytes: n(row.size_in_bytes),
      fileName: s(row.file_name),
      description: s(row.description),
    } satisfies NexusFileAttachment;
  });
};

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

    if (!CONFIG.nexusApiKey) {
      return reply.code(503).send({ error: 'NEXUS_API_KEY is not configured on the server' });
    }

    const game = SUPPORTED_GAMES.find(g => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const modId = parseInt(rawModId, 10);
    if (!Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "modId" must be a positive integer' });
    }

    try {
      // Prefer GraphQL v2 for normalized rich shape, but fall back to REST v1
      // for legacy mods that are visible on site yet not indexed by GraphQL.
      let mod: NexusModView;
      try {
        mod = await getNexus().getModById(game.domainName, game.nexusId, modId) as NexusModView;
      } catch (err) {
        if (err instanceof NexusModsNotFoundError || err instanceof NexusModsError) {
          log.warn(`Nexus GraphQL mod lookup fallback to REST for ${gameId}/${modId}: ${err.message}`);
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
      const result = await getNexus().findPossibleTranslations(game.domainName, game.nexusId, modId, {
        language: language?.trim() || undefined,
        count,
        includeDescriptionSearch: true,
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof NexusModsNotFoundError || err instanceof NexusModsError) {
        // Fallback for mods unavailable in GraphQL index: return empty list
        // instead of surfacing a hard error in UI.
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
