/**
 * Every address the UI links to, built in one place.
 *
 * A game's sections live under `/games/:gameId` and share the game layout (crumb and
 * tabs); the mod editor is under the same prefix but takes the whole screen.
 */

const enc = encodeURIComponent;

const withQuery = (path: string, query?: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
};

/** The sections of a game, in tab order; `mods` is the game's index page. */
export const GAME_SECTIONS = [
  'mods',
  'nexus',
  'coherence',
  'diff',
  'reference',
  'glossary',
  'vortex',
] as const;

export type GameSection = (typeof GAME_SECTIONS)[number];

const game = (gameId: string): string => `/games/${enc(gameId)}`;

const gameSection = (gameId: string, section: GameSection): string =>
  section === 'mods' ? game(gameId) : `${game(gameId)}/${section}`;

const mod = (
  gameId: string,
  modId: number | string,
  query?: Record<string, string | number | undefined>,
): string => withQuery(`${game(gameId)}/mods/${enc(String(modId))}`, query);

export const routes = {
  games: (): string => '/',
  game,
  gameSection,
  nexusMod: (gameId: string, nexusModId: number | string): string =>
    `${game(gameId)}/nexus/${enc(String(nexusModId))}`,
  diff: (gameId: string, pair?: { newModId?: number | string; oldModId?: number | string }) =>
    withQuery(gameSection(gameId, 'diff'), pair),
  mod,
  modInnr: (gameId: string, modId: number | string): string => `${mod(gameId, modId)}/innr`,
  settings: (tab?: string, query?: Record<string, string | number | undefined>): string =>
    withQuery('/settings', { tab, ...query }),
  systemLog: (): string => '/system-log',
};

/** Route patterns for the router, relative ones for the children of the game layout. */
export const routePatterns = {
  game: '/games/:gameId',
  nexusMod: 'nexus/:nexusModId',
  modsList: '/games/:gameId/mods',
  mod: '/games/:gameId/mods/:modId',
  modInnr: '/games/:gameId/mods/:modId/innr',
  legacyGlossary: '/glossary',
} as const;
