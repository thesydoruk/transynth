/** A single entry from GET /api/games — matches GameInfo in src/web/routes/games.ts */
export type GameInfo = {
  /** Internal game identifier: fo4 | fo76 | fo3 | fnv | ob | mw | sse | sle | disco */
  id: string;
  /** Human-readable title, e.g. "Fallout 4" */
  name: string;
  /** Developer / studio name */
  developer: string;
  /** Original release year */
  releaseYear: number;
  /** NexusMods numeric game ID, used to build the cover image URL */
  nexusId: number;
  /**
   * NexusMods URL-safe domain name (e.g. "fallout4").
   * Used as the gameDomainName filter in NexusMods GraphQL requests.
   */
  domainName: string;
  /** Engine family label */
  engine: string;
  /** Whether the game uses localized (external .STRINGS) plugins */
  localized: boolean;
};
