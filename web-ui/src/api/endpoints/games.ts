import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, downloadBinary, req } from '../client';
import type {
  GameInfo,
  ModImportJob,
  NexusModDetails,
  NexusModRelationsResult,
  NexusModsPage,
  NexusTranslationsResult,
} from '../types';

export const gamesEndpoints = {
  /** Returns all supported games as a JSON array. */
  list: () => req<GameInfo[]>('/api/games'),
  /** Returns the URL for a game's cover image (served via backend cache). */
  coverUrl: (gameId: string) => `${BASE}/api/games/cover/${gameId}`,
  /**
   * Searches NexusMods for mods in a specific game.
   * Requires NEXUS_API_KEY to be configured on the server.
   *
   * @param gameId  - Internal game ID (e.g. "fo4")
   * @param query   - Search query (mod title / keywords)
   * @param count   - Max results per page (default 20, max 50)
   * @param offset  - Zero-based result offset for pagination
   */
  searchMods: (gameId: string, query: string, count = 20, offset = 0) =>
    req<NexusModsPage>(
      `/api/games/${encodeURIComponent(gameId)}/nexus/mods?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}`,
    ),
  /**
   * Loads one mod with full metadata and all attached files.
   *
   * @param gameId - Internal game ID (e.g. "fo4")
   * @param modId  - Nexus public mod ID
   */
  modDetails: (gameId: string, modId: number) =>
    req<NexusModDetails>(`/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}`),
  /** Downloads a Nexus file through the backend proxy. */
  downloadModFile: (gameId: string, modId: number, fileId: number, fallbackName: string) =>
    downloadBinary(
      `/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}/file/${fileId}/download`,
      fallbackName,
    ),
  /** Downloads a Nexus file to the server and creates a mod import job. */
  importModFile: (
    gameId: string,
    modId: number,
    fileId: number,
    srcLang = getSrcLang(),
    tgtLang = getTgtLang(),
  ) =>
    req<ModImportJob>(
      `/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}/file/${fileId}/import`,
      {
        method: 'POST',
        body: JSON.stringify({ srcLang, tgtLang }),
      },
    ),
  /**
   * Loads official Nexus requirement relations for one mod.
   *
   * @param gameId - Internal game ID (e.g. "fo4")
   * @param modId  - Nexus public mod ID
   * @param count  - Max items per relation list (default 100, max 200)
   */
  modRelations: (gameId: string, modId: number, count = 100) =>
    req<NexusModRelationsResult>(
      `/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}/relations?count=${count}`,
    ),
  /**
   * Finds heuristically ranked translation candidates for a mod.
   * Requires NEXUS_API_KEY to be configured on the server.
   *
   * @param gameId   - Internal game ID (e.g. "fo4")
   * @param modId    - NexusMods public mod ID of the source mod
   * @param language - Optional language filter (e.g. "ukrainian", "russian")
   * @param count    - Max raw candidates to score (default 50, max 100)
   */
  findTranslations: (gameId: string, modId: number, language?: string, count = 50) => {
    const params = new URLSearchParams({ modId: String(modId), count: String(count) });
    if (language) params.set('language', language);
    return req<NexusTranslationsResult>(
      `/api/games/${encodeURIComponent(gameId)}/nexus/translations?${params.toString()}`,
    );
  },
};
