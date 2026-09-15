import type { GameId } from '../../types';

/**
 * Everything the app needs to *show* a game before anything is imported:
 * the catalogue tile, the Nexus lookups, the human-readable label.
 *
 * This is pure data — no behaviour — so a title that Transynth cannot process
 * yet can still be listed while its adapters are being written.
 */
export type GameCatalogueEntry = {
  /** Internal identifier, also the `mods.game` column value. Lowercase, url-safe. */
  id: GameId;
  /** Human-readable title, e.g. `Fallout 4`. */
  name: string;
  /** Studio shown under the title on the catalogue tile. */
  developer: string;
  /** Release year, informational. */
  releaseYear: number;
  /** Engine family label shown as a tag, e.g. `Creation Engine`. */
  engine: string;
  /** True when the game keeps its text in external string tables rather than inside the plugin. */
  localized: boolean;
  /**
   * NexusMods integration, when the game exists there.
   *
   * `id` is the numeric id used to build the cover-tile CDN url; `domain` is
   * the url-safe name used as `gameDomainName` in NexusMods GraphQL queries.
   * A game absent from NexusMods leaves this out and simply gets no cover.
   */
  nexus?: { id: number; domain: string };
};
