/**
 * Public TypeScript types for the NexusModsClient.
 *
 * All types here describe shapes that come from the NexusMods GraphQL API v2
 * (https://api.nexusmods.com/v2/graphql) and are mapped by the client before
 * being returned to callers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort direction for search results.
 *
 * `DESC` orders results newest-first (default).
 * `ASC` orders results oldest-first.
 */
export type SortDirection = 'ASC' | 'DESC';

/**
 * A language name used to filter translation candidates.
 *
 * The value is passed as-is to the NexusMods search filter, so it should be a
 * lowercase language name understood by the API (e.g. `"ukrainian"`,
 * `"russian"`, `"german"`).
 *
 * Using an enum/literal union here would make the client too rigid — new
 * languages can be added on the Nexus side without a breaking library update.
 */
export type TranslationLanguage = string;

// ─────────────────────────────────────────────────────────────────────────────
// Client configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructor options for {@link NexusModsClient}.
 *
 * All fields are optional. The client has sensible defaults for everything
 * except `accessToken`, which is optional only because the cover-image CDN
 * does not require auth. The GraphQL API however will reject requests without
 * a valid API key with HTTP 401.
 */
export interface NexusModsClientOptions {
  /**
   * GraphQL endpoint URL.
   *
   * @default "https://api.nexusmods.com/v2/graphql"
   */
  endpoint?: string;

  /**
   * Request timeout in milliseconds. Applies to each individual HTTP call.
   *
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Value for the `User-Agent` request header.
   *
   * NexusMods ToS requires a descriptive user agent.
   *
   * @default "storywealth-localizer/1.0"
   */
  userAgent?: string;

  /**
   * NexusMods personal API key (Bearer token).
   *
   * Obtained from https://www.nexusmods.com/users/myaccount?tab=api
   *
   * Required for GraphQL queries. Store in the `NEXUS_API_KEY` env variable.
   */
  accessToken?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Method option bags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for {@link NexusModsClient.searchModsByName}.
 */
export interface SearchModsByNameOptions {
  /**
   * When `true`, uses stemmed (NLP-normalized) name matching instead of
   * wildcard matching. This is usually more robust when the query might not
   * exactly match punctuation or word forms.
   *
   * @default false
   */
  useStemmedSearch?: boolean;

  /**
   * Restrict results to a specific game domain name (e.g. `"fallout4"`).
   * When combined with `gameId`, both filters are applied simultaneously.
   */
  gameDomainName?: string;

  /**
   * Restrict results to a specific Nexus numeric game ID (e.g. `1151` for FO4).
   * When combined with `gameDomainName`, both filters are applied simultaneously.
   */
  gameId?: number;

  /**
   * Pagination offset into the total result set.
   *
   * @default 0
   */
  offset?: number;

  /**
   * Maximum number of results to return per page.
   *
   * @default 20
   */
  count?: number;

  /**
   * Sort direction for the `updatedAt` field.
   *
   * `DESC` (default) puts recently updated mods first.
   */
  updatedSortDirection?: SortDirection;
}

/**
 * Options for {@link NexusModsClient.findPossibleTranslations}.
 */
export interface FindPossibleTranslationsOptions {
  /**
   * Optional language keyword to bias the search toward a specific language.
   *
   * When provided, mods whose name / summary / description mention the
   * language get a higher heuristic score.
   */
  language?: TranslationLanguage;

  /**
   * Pagination offset into the raw translation candidate pool.
   *
   * @default 0
   */
  offset?: number;

  /**
   * Maximum number of raw candidates to fetch before scoring and ranking.
   * A larger value produces more accurate Top-N results at the cost of extra
   * data transfer.
   *
   * @default 50
   */
  count?: number;

  /**
   * Whether to keep the source mod itself in the returned candidate list.
   *
   * @default false
   */
  includeOriginalMod?: boolean;

  /**
   * Whether to check mod descriptions (long free-text) for translation
   * keywords when scoring candidates. Adds score for each matching keyword
   * but is slower to process.
   *
   * @default true
   */
  includeDescriptionSearch?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain entities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Nexus Mods game record, as returned by the GraphQL API.
 */
export interface NexusGame {
  /** Numeric Nexus game ID (e.g. `1151` for Fallout 4). */
  id: number;

  /** Human-readable game title. */
  name: string;

  /**
   * URL-safe domain name used in Nexus Mods URLs (e.g. `"fallout4"`).
   * This is the identifier most API calls use to scope results to a game.
   */
  domainName: string;

  /** Genre string, or `null` when the API does not provide it. */
  genre: string | null;

  /** URL of the game's forum thread on NexusMods, or `null`. */
  forumUrl: string | null;

  /** Total count of published mods for the game, or `null`. */
  modCount: number | null;

  /**
   * Total download count string (may be a formatted number like `"12,345,678"`),
   * or `null`.
   */
  downloadCount: string | null;

  /** Unique download count string, or `null`. */
  uniqueDownloadCount: string | null;
}

/**
 * A Nexus Mods mod record, fully hydrated with game and uploader info.
 */
export interface NexusMod {
  /**
   * Internal Nexus node ID (numeric, may equal `modId` in most cases).
   * If the API only returns `modId`, this field will have the same value.
   */
  id: number;

  /**
   * Public mod ID within the game domain.
   * Together with `game.domainName`, this uniquely identifies a mod.
   */
  modId: number;

  /** Unique identifier string across all Nexus content. */
  uid: string;

  /** Mod display name as set by the author. */
  name: string;

  /** Short plain-text summary (shown in search listings). */
  summary: string;

  /** Full description, may contain HTML/Nexus BBCode. */
  description: string;

  /** Version string (e.g. `"1.4.2"`). */
  version: string;

  /** Category name (e.g. `"Models and Textures"`). */
  category: string;

  /** Publication status (e.g. `"published"`, `"hidden"`). */
  status: string;

  /** Uploader's display name, or `null` when not provided. */
  author: string | null;

  /** ISO 8601 creation timestamp (e.g. `"2015-11-10T00:00:00.000Z"`). */
  createdAt: string;

  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;

  /** Total download count (all versions). */
  downloads: number;

  /** Endorsement count. */
  endorsements: number;

  /** Whether the mod has been flagged as adult content, or `null`. */
  adultContent: boolean | null;

  /** URL to the mod's primary cover image, or `null`. */
  pictureUrl: string | null;

  /** URL to the mod's thumbnail image, or `null`. */
  thumbnailUrl: string | null;

  /** Numeric Nexus game ID this mod belongs to. */
  gameId: number;

  /** Full game info object for the game this mod belongs to. */
  game: NexusGame;

  /**
   * Uploader account info, or `null` when the API does not provide it.
   */
  uploader: { memberId: number | null; name: string } | null;

  /**
   * Array of tag names assigned to the mod (e.g. `["Translation", "Ukrainian"]`).
   * Empty array when no tags are assigned.
   */
  tags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginated search result returned by {@link NexusModsClient.searchModsByName}.
 */
export interface NexusModSearchResult {
  /** Total count of matching mods in the index (may exceed `items.length`). */
  totalCount: number;

  /** Count of nodes actually returned in this page. */
  nodesCount: number;

  /** Hydrated mod objects for this page. */
  items: NexusMod[];
}

/**
 * A scored translation mod candidate produced by the heuristic scorer.
 */
export interface TranslationCandidate {
  /** The candidate mod. */
  mod: NexusMod;

  /**
   * Heuristic relevance score.
   *
   * The score is additive — each matching signal adds points:
   * - Same game (+10)
   * - Title contains source mod name (+25)
   * - Title contains translation keywords (+20 each)
   * - Summary contains keywords (+8 each)
   * - Description contains keywords (+4 each, if enabled)
   *
   * Candidates with a final score of `0` are excluded from results.
   */
  score: number;

  /**
   * Human-readable reasons for the assigned score.
   * Useful for debugging or displaying scoring rationale in the UI.
   *
   * Examples: `"same-game"`, `"title-contains-translation"`, etc.
   */
  reasons: string[];
}

/**
 * Full result set returned by {@link NexusModsClient.findPossibleTranslations}.
 */
export interface TranslationSearchResult {
  /** The source mod that was used as the search seed. */
  sourceMod: NexusMod;

  /**
   * Total count of raw candidates found before scoring.
   * May be much larger than `items.length` after filtering out low-score entries.
   */
  totalCount: number;

  /** Count of raw candidates returned in this page. */
  nodesCount: number;

  /**
   * Scored and ranked translation candidates.
   * Sorted by `score` descending, then by `updatedAt` descending for ties.
   * Only candidates with `score > 0` are included.
   */
  items: TranslationCandidate[];
}
