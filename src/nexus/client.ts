/**
 * NexusModsClient — a thin TypeScript client for the NexusMods GraphQL API v2.
 *
 * ## Design principles
 *
 * - **Single transport**: uses the platform-native `fetch` only (no axios or
 *   other HTTP library). This matches the rest of the backend codebase.
 * - **Single mapping layer**: all raw API objects pass through `mapMod` /
 *   `mapGame` before being returned. Field renames or type coercions live in
 *   one place only.
 * - **Small public surface**: three primary query methods + one composite
 *   heuristic method. Everything else is private implementation detail.
 * - **Fail loud**: invalid inputs throw `NexusModsError` immediately rather
 *   than silently producing wrong results.
 *
 * ## Authentication
 *
 * The NexusMods GraphQL API v2 requires a personal API key passed as a Bearer
 * token. Obtain yours at:
 *   https://www.nexusmods.com/users/myaccount?tab=api
 *
 * Set `NEXUS_API_KEY` in your `.env` file and the project's `CONFIG` will
 * inject it automatically via `createNexusClient()` in index.ts.
 *
 * @see {@link NexusModsClientOptions} for all constructor options.
 */

import {
  FindPossibleTranslationsOptions,
  NexusGame,
  NexusMod,
  NexusModSearchResult,
  NexusModsClientOptions,
  SearchModsByNameOptions,
  SortDirection,
  TranslationCandidate,
  TranslationLanguage,
  TranslationSearchResult,
} from './types.js';
import {
  NexusModsError,
  NexusModsGraphQLError,
  NexusModsNotFoundError,
} from './errors.js';
import {
  GET_GAME_BY_ID_QUERY,
  GET_MOD_BY_ID_QUERY,
  SEARCH_MODS_BY_NAME_QUERY,
  SEARCH_TRANSLATION_CANDIDATES_QUERY,
} from './graphql.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types — kept private to avoid leaking unstable API shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic GraphQL response envelope.
 *
 * Per the GraphQL specification, a successful response always has `data`.
 * An error response can have `errors` (with or without partial `data`).
 */
interface GraphQLResponse<TData> {
  data?: TData;
  errors?: unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// NexusModsClient
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A reusable client for the NexusMods GraphQL API v2.
 *
 * ### Usage
 * ```typescript
 * import { createNexusClient } from './nexus/index.js';
 *
 * const nexus = createNexusClient(); // reads NEXUS_API_KEY from env
 *
 * const results = await nexus.searchModsByName('Fallout 4', {
 *   gameDomainName: 'fallout4',
 *   count: 10,
 * });
 * ```
 */
export class NexusModsClient {
  /** Full GraphQL endpoint URL. */
  private readonly endpoint: string;

  /** Default headers sent with every request. */
  private readonly headers: Record<string, string>;

  /** Request timeout in milliseconds. */
  private readonly timeoutMs: number;

  /**
   * Constructs a new client instance.
   *
   * @param options - Optional configuration. See {@link NexusModsClientOptions}.
   */
  public constructor(options: NexusModsClientOptions = {}) {
    this.endpoint = options.endpoint ?? 'https://api.nexusmods.com/v2/graphql';
    this.timeoutMs = options.timeoutMs ?? 30_000;

    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': options.userAgent ?? 'storywealth-localizer/1.0',
      ...(options.accessToken
        ? { apikey: options.accessToken }
        : {}),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Searches mods by title.
   *
   * Supports two search styles controlled by `options.useStemmedSearch`:
   *
   * - **Wildcard** (default): wraps the query in `*...*`, matching any mods
   *   whose title contains the query string. Good for exact substring matches.
   * - **Stemmed**: passes the query through the server-side NLP stemmer which
   *   normalises word forms. Better when the query may use alternate forms
   *   (plurals, possessives, grammatical cases).
   *
   * @param name - The title to search for. Must not be empty or whitespace-only.
   * @param options - Optional filters, pagination, and sort.
   * @returns Paginated list of matching mods.
   * @throws {NexusModsError} If `name` is empty or the request fails.
   * @throws {NexusModsGraphQLError} If the API returns GraphQL errors.
   */
  public async searchModsByName(
    name: string,
    options: SearchModsByNameOptions = {},
  ): Promise<NexusModSearchResult> {
    const normalizedName = this.normalizeQuery(name);

    if (!normalizedName) {
      throw new NexusModsError('The mod name query must not be empty.');
    }

    // Build the filter clause array. Each entry is ANDed together.
    const filterClauses: unknown[] = [];

    // Name filter.
    // NOTE: Some Nexus GraphQL schema revisions do not expose `nameStemmed`.
    // We keep the option for API compatibility, but always use `name` wildcard
    // to avoid GraphQL validation failures that surface as 502 in our routes.
    filterClauses.push({
      name: [{ value: `*${normalizedName}*`, op: 'WILDCARD' }],
    });

    // Optional game domain name filter
    if (typeof options.gameDomainName === 'string' && options.gameDomainName.trim()) {
      filterClauses.push({
        gameDomainName: [{ value: options.gameDomainName.trim(), op: 'EQUALS' }],
      });
    }

    // Optional game ID filter
    if (typeof options.gameId === 'number') {
      filterClauses.push({
        gameId: [{ value: options.gameId, op: 'EQUALS' }],
      });
    }

    const data = await this.request<{
      mods: { totalCount: number; nodesCount: number; nodes: unknown[] };
    }>(SEARCH_MODS_BY_NAME_QUERY, {
      filter: { op: 'AND', filter: filterClauses },
      offset: options.offset ?? 0,
      count: options.count ?? 20,
    });

    return {
      totalCount: data.mods.totalCount,
      nodesCount: data.mods.nodesCount,
      items: data.mods.nodes.map((item) => this.mapMod(item)),
    };
  }

  /**
   * Fetches a single game record by its numeric Nexus game ID.
   *
   * @param gameId - A positive integer Nexus game ID (e.g. `1151` for FO4).
   * @returns The game record.
   * @throws {NexusModsError} If `gameId` is not a positive integer.
   * @throws {NexusModsNotFoundError} If the game does not exist.
   * @throws {NexusModsGraphQLError} If the API returns GraphQL errors.
   */
  public async getGameById(gameId: number): Promise<NexusGame> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new NexusModsError('The game id must be a positive integer.');
    }

    const data = await this.request<{ game: unknown | null }>(GET_GAME_BY_ID_QUERY, {
      id: gameId,
    });

    if (!data.game) {
      throw new NexusModsNotFoundError(`Game with id "${gameId}" was not found.`);
    }

    return this.mapGame(data.game);
  }

  /**
   * Fetches a single mod by game domain name and public mod ID.
   *
   * Nexus Mods mod IDs are only unique within a game domain, so both values
   * are required.
   *
   * @param domainName - The game's domain name (e.g. `"fallout4"`).
   * @param modId - The public numeric mod ID.
   * @returns The fully hydrated mod record.
   * @throws {NexusModsError} If arguments are invalid.
   * @throws {NexusModsNotFoundError} If the mod does not exist.
   * @throws {NexusModsGraphQLError} If the API returns GraphQL errors.
   */
  public async getModById(domainName: string, modId: number): Promise<NexusMod> {
    const normalizedDomainName = domainName.trim();

    if (!normalizedDomainName) {
      throw new NexusModsError('The game domain name must not be empty.');
    }

    if (!Number.isInteger(modId) || modId <= 0) {
      throw new NexusModsError('The mod id must be a positive integer.');
    }

    const data = await this.request<{
      mods: { totalCount: number; nodesCount: number; nodes: unknown[] };
    }>(GET_MOD_BY_ID_QUERY, { domainName: normalizedDomainName, modId });

    const first = data.mods.nodes[0];

    if (!first) {
      throw new NexusModsNotFoundError(
        `Mod "${normalizedDomainName}/${modId}" was not found.`,
      );
    }

    return this.mapMod(first);
  }

  /**
   * Searches for mods that are likely translations of a given source mod.
   *
   * ## How it works
   *
   * Because the NexusMods v2 GraphQL schema does not expose a dedicated
   * "translations for mod X" query, this method uses heuristics:
   *
   * 1. Fetch the source mod → extract its title tokens.
   * 2. Search for mods in the same game whose titles contain those tokens.
   * 3. Optionally filter by language name.
   * 4. Score each candidate based on how many translation signals it matches
   *    (language keywords in title/summary/description, name overlap, etc.).
   * 5. Return candidates sorted by score descending, zero-score entries removed.
   *
   * @param domainName - Game domain name of the source mod.
   * @param modId - Public mod ID of the source mod.
   * @param options - Optional language, pagination, and scoring options.
   * @returns Source mod + scored, ranked translation candidates.
   * @throws {NexusModsNotFoundError} If the source mod does not exist.
   * @throws {NexusModsError} If arguments are invalid or the request fails.
   */
  public async findPossibleTranslations(
    domainName: string,
    modId: number,
    options: FindPossibleTranslationsOptions = {},
  ): Promise<TranslationSearchResult> {
    const sourceMod = await this.getModById(domainName, modId);
    const language = this.normalizeLanguage(options.language);
    const sourceTokens = this.extractImportantTokens(sourceMod.name);
    const translationKeywords = this.getTranslationKeywords(language);

    /**
     * Build a broad filter to catch common translation naming patterns:
     *   "Mod Name - Ukrainian Translation"
     *   "Русский перевод — Mod Name"
     *   "Translation of Mod Name"
     *
     * We use stemmed matching on individual tokens rather than one exact
     * phrase, which gives the search more flexibility.
     */
    const rootClauses: unknown[] = [
      {
        gameDomainName: [{ value: sourceMod.game.domainName, op: 'EQUALS' }],
      },
    ];

    // Build an OR group for source tokens using wildcard title matching.
    // This is more broadly schema-compatible than `nameStemmed`.
    const tokenClauses = sourceTokens.map((token) => ({
      name: [{ value: `*${token}*`, op: 'WILDCARD' }],
    }));

    if (tokenClauses.length > 0) {
      rootClauses.push({ op: 'OR', filter: tokenClauses });
    }

    // Optionally add a language token filter to bias API-side results.
    // We use title wildcard matching instead of `languageName` for compatibility.
    if (language) {
      rootClauses.push({
        name: [{ value: `*${language}*`, op: 'WILDCARD' }],
      });
    }

    const data = await this.request<{
      mods: { totalCount: number; nodesCount: number; nodes: unknown[] };
    }>(SEARCH_TRANSLATION_CANDIDATES_QUERY, {
      filter: { op: 'AND', filter: rootClauses },
      offset: options.offset ?? 0,
      count: options.count ?? 50,
    });

    const rawMods = data.mods.nodes.map((item) => this.mapMod(item));

    // Remove the source mod itself from candidates unless explicitly requested
    const candidates = rawMods.filter((candidate) => {
      if (options.includeOriginalMod) return true;
      return !(
        candidate.game.domainName === sourceMod.game.domainName &&
        candidate.modId === sourceMod.modId
      );
    });

    // Score and sort candidates — discard anything with score === 0
    const scored: TranslationCandidate[] = candidates
      .map((candidate) =>
        this.scoreTranslationCandidate(
          sourceMod,
          candidate,
          translationKeywords,
          language,
          options.includeDescriptionSearch ?? true,
        ),
      )
      .filter((c) => c.score > 0)
      .sort((a, b) => {
        // Primary: score descending
        if (b.score !== a.score) return b.score - a.score;
        // Tie-breaker: recently updated first
        return b.mod.updatedAt.localeCompare(a.mod.updatedAt);
      });

    return {
      sourceMod,
      totalCount: data.mods.totalCount,
      nodesCount: data.mods.nodesCount,
      items: scored,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HTTP layer
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Sends a GraphQL POST request to the endpoint and returns the typed data.
   *
   * Uses `AbortController` + `setTimeout` to enforce the configured timeout,
   * since native `fetch` does not have a built-in timeout option.
   *
   * Error mapping:
   * - Non-2xx HTTP status → `NexusModsError`
   * - `errors` in GraphQL response body → `NexusModsGraphQLError`
   * - Missing `data` in response body → `NexusModsError`
   * - Network failure / timeout → `NexusModsError` (with original cause)
   *
   * @param query - A complete GraphQL query string.
   * @param variables - Variables object matching the query parameter declarations.
   * @returns The typed `data` field of the response envelope.
   */
  private async request<TData>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<TData> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new NexusModsError(
          `NexusMods API returned HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const body = (await response.json()) as GraphQLResponse<TData>;

      if (body.errors && body.errors.length > 0) {
        throw new NexusModsGraphQLError(
          'The Nexus Mods GraphQL API returned errors.',
          body.errors,
        );
      }

      if (!body.data) {
        throw new NexusModsError('The Nexus Mods GraphQL API returned no data.');
      }

      return body.data;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      // Re-throw our own domain errors unchanged
      if (error instanceof NexusModsError) throw error;

      // Handle AbortController timeout (Node.js throws DOMException or an Error
      // with name "AbortError" depending on the runtime version)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NexusModsError(
          `NexusMods API request timed out after ${this.timeoutMs} ms.`,
        );
      }

      throw new NexusModsError('The request to Nexus Mods failed.', error);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mapping layer  (raw API → typed domain objects)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Maps a raw game object from the GraphQL response into a {@link NexusGame}.
   *
   * Throws `NexusModsError` if any required field is absent or has an
   * unexpected type, producing a meaningful error instead of a runtime
   * `TypeError` deep in caller code.
   */
  private mapGame(input: unknown): NexusGame {
    const value = this.asRecord(input);

    return {
      id: this.toNumber(value['id']),
      name: this.toString(value['name']),
      domainName: this.toString(value['domainName']),
      genre: this.toNullableString(value['genre']),
      forumUrl: this.toNullableString(value['forumUrl']),
      modCount: this.toNullableNumber(value['modCount']),
      downloadCount: this.toNullableString(value['downloadCount']),
      uniqueDownloadCount: this.toNullableString(value['uniqueDownloadCount']),
    };
  }

  /**
   * Maps a raw mod object from the GraphQL response into a {@link NexusMod}.
   *
   * Handles the nested `game` and `uploader` objects, and flattens the
   * `tags` array of `{ name: string }` objects into a plain `string[]`.
   */
  private mapMod(input: unknown): NexusMod {
    const value = this.asRecord(input);

    // Flatten tags: [{ name: "Ukrainian" }, ...] → ["Ukrainian", ...]
    const tags = Array.isArray(value['tags'])
      ? (value['tags'] as unknown[])
          .map((tag) => this.asRecord(tag)['name'])
          .filter((tagName): tagName is string => typeof tagName === 'string')
      : [];

    return {
      id: this.toNumber(value['id']),
      modId: this.toNumber(value['modId']),
      uid: this.toString(value['uid']),
      name: this.toString(value['name']),
      summary: this.toString(value['summary']),
      description: this.toString(value['description']),
      version: this.toString(value['version']),
      category: this.toString(value['category']),
      status: this.toString(value['status']),
      author: this.toNullableString(value['author']),
      createdAt: this.toString(value['createdAt']),
      updatedAt: this.toString(value['updatedAt']),
      downloads: this.toNumber(value['downloads']),
      endorsements: this.toNumber(value['endorsements']),
      adultContent: this.toNullableBoolean(value['adultContent']),
      pictureUrl: this.toNullableString(value['pictureUrl']),
      thumbnailUrl: this.toNullableString(value['thumbnailUrl']),
      gameId: this.toNumber(value['gameId']),
      game: this.mapGame(value['game']),
      uploader: value['uploader']
        ? {
            memberId: this.toNullableNumber(
              this.asRecord(value['uploader'])['memberId'],
            ),
            name: this.toString(this.asRecord(value['uploader'])['name']),
          }
        : null,
      tags,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Translation scoring heuristics
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Assigns a heuristic relevance score to a single translation candidate.
   *
   * Scoring signals (additive):
   * | Signal | Points |
   * |---|---|
   * | Same game as source | +10 |
   * | Candidate title contains full source name | +25 |
   * | Candidate title shares ≥ 2 tokens with source | +10 |
   * | Translation keyword in title | +20 each |
   * | Translation keyword in summary | +8 each |
   * | Translation keyword in description (if enabled) | +4 each |
   * | Language name in title | +15 |
   * | Language name in summary | +6 |
   *
   * Candidates with a score below 20 that don't title-contain the source name
   * are reset to 0 to avoid returning unrelated mods sharing generic tokens.
   */
  private scoreTranslationCandidate(
    sourceMod: NexusMod,
    candidate: NexusMod,
    translationKeywords: string[],
    language: string | null,
    includeDescriptionSearch: boolean,
  ): TranslationCandidate {
    const reasons: string[] = [];
    let score = 0;

    const sourceName = sourceMod.name.toLowerCase();
    const candidateName = candidate.name.toLowerCase();
    const candidateSummary = candidate.summary.toLowerCase();
    const candidateDescription = candidate.description.toLowerCase();

    // Same-game bonus
    if (candidate.game.domainName === sourceMod.game.domainName) {
      score += 10;
      reasons.push('same-game');
    }

    // Title containment
    if (candidateName.includes(sourceName)) {
      score += 25;
      reasons.push('title-contains-source-mod-name');
    } else {
      // Partial token overlap fallback
      const matchedTokenCount = this.extractImportantTokens(sourceMod.name).filter(
        (token) => candidateName.includes(token),
      ).length;

      if (matchedTokenCount >= 2) {
        score += 10;
        reasons.push('title-shares-source-mod-tokens');
      }
    }

    // Translation keyword signals
    for (const keyword of translationKeywords) {
      if (candidateName.includes(keyword)) {
        score += 20;
        reasons.push(`title-contains-${keyword}`);
      }

      if (candidateSummary.includes(keyword)) {
        score += 8;
        reasons.push(`summary-contains-${keyword}`);
      }

      if (includeDescriptionSearch && candidateDescription.includes(keyword)) {
        score += 4;
        reasons.push(`description-contains-${keyword}`);
      }
    }

    // Language name signals
    if (language) {
      if (candidateName.includes(language)) {
        score += 15;
        reasons.push(`title-contains-language-${language}`);
      }

      if (candidateSummary.includes(language)) {
        score += 6;
        reasons.push(`summary-contains-language-${language}`);
      }
    }

    // Suppress weak generic matches — avoid returning unrelated mods that
    // merely share stop-word-free tokens with the source mod.
    if (!candidateName.includes(sourceName) && score < 20) {
      score = 0;
      reasons.push('weak-match');
    }

    return { mod: candidate, score, reasons: this.uniqueStrings(reasons) };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Keyword helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Returns the union of generic translation keywords and any language-specific
   * keywords for the given language.
   *
   * The generic list covers multiple natural languages for broad coverage. The
   * per-language supplemental list adds native-language spellings and common
   * abbreviations.
   *
   * @param language - Normalized language name (lowercase), or `null`.
   */
  private getTranslationKeywords(language: string | null): string[] {
    const baseKeywords = [
      'translation',
      'translate',
      'translated',
      'translator',
      'localization',
      'localisation',
      'language pack',
      'lang pack',
      // Slavic
      'перевод',
      'переклад',
      // Romance
      'traduction',
      // Germanic
      'übersetzung',
      // Short alias
      'tl',
    ];

    if (!language) {
      return this.uniqueStrings(baseKeywords);
    }

    const languageKeywords: Record<string, string[]> = {
      ukrainian: ['ukrainian', 'україн', 'ua'],
      russian: ['russian', 'рус', 'ru'],
      polish: ['polish', 'polski', 'pl'],
      german: ['german', 'deutsch', 'de'],
      french: ['french', 'français', 'francais', 'fr'],
      spanish: ['spanish', 'español', 'espanol', 'es'],
      italian: ['italian', 'italiano', 'it'],
      czech: ['czech', 'čeština', 'cestina', 'cz'],
      japanese: ['japanese', '日本語', 'jp'],
      korean: ['korean', '한국어', 'kr'],
      chinese: ['chinese', '中文', 'cn', 'zh'],
    };

    return this.uniqueStrings([
      ...baseKeywords,
      ...(languageKeywords[language] ?? [language]),
    ]);
  }

  /**
   * Splits a mod name into meaningful non-trivial tokens.
   *
   * Strips English stop words and short tokens so that translation-candidate
   * matching is based on the distinctive parts of a mod's name rather than
   * generic words like "the", "for", or "edition".
   *
   * Supports both Latin and Cyrillic word boundaries.
   *
   * @param value - A mod display name.
   * @returns Deduplicated array of lowercase tokens (length ≥ 3, non-stop-word).
   */
  private extractImportantTokens(value: string): string[] {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'mod', 'mods',
      'of', 'a', 'an', 'to', 'in', 'on',
      'edition', 'special',
    ]);

    return this.uniqueStrings(
      value
        .toLowerCase()
        .split(/[^a-z0-9а-яіїєґё]+/iu)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3 && !stopWords.has(part)),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Utility / normalisation helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Normalizes a raw language option: trims, lowercases, returns `null` for
   * empty or absent values.
   */
  private normalizeLanguage(language: TranslationLanguage | undefined): string | null {
    if (!language) return null;
    const normalized = language.trim().toLowerCase();
    return normalized || null;
  }

  /**
   * Collapses redundant whitespace in a search query and strips leading/
   * trailing whitespace.
   */
  private normalizeQuery(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  /**
   * Returns the provided direction, defaulting to `"DESC"` when absent.
   */
  private normalizeSortDirection(direction: SortDirection | undefined): SortDirection {
    return direction ?? 'DESC';
  }

  /**
   * Deduplicate a string array while preserving insertion order.
   *
   * Comparison is case-insensitive and trims whitespace, so duplicates that
   * differ only in casing are collapsed. The first occurrence is kept.
   */
  private uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const key = value.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }

    return result;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Type-safe coercion helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Narrows `unknown` to a plain object record.
   * Throws `NexusModsError` for arrays, primitives, or `null`.
   */
  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new NexusModsError('Expected an object from the API response.');
    }
    return value as Record<string, unknown>;
  }

  /**
   * Coerces an unknown API value to a non-null string.
   * Numbers and booleans are stringified. Throws on anything else.
   */
  private toString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new NexusModsError('Expected a string-compatible value from the API response.');
  }

  /**
   * Returns `null` if the value is nullish, otherwise delegates to `toString`.
   */
  private toNullableString(value: unknown): string | null {
    if (value == null) return null;
    return this.toString(value);
  }

  /**
   * Coerces an unknown API value to a finite number.
   * Handles both numeric and numeric-string forms.
   */
  private toNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }

    throw new NexusModsError('Expected a numeric value from the API response.');
  }

  /**
   * Returns `null` if the value is nullish, otherwise delegates to `toNumber`.
   */
  private toNullableNumber(value: unknown): number | null {
    if (value == null) return null;
    return this.toNumber(value);
  }

  /**
   * Coerces an unknown API value to a boolean.
   * Returns `null` for nullish inputs. Throws for non-boolean non-null values.
   */
  private toNullableBoolean(value: unknown): boolean | null {
    if (value == null) return null;
    if (typeof value === 'boolean') return value;
    throw new NexusModsError('Expected a boolean value from the API response.');
  }
}
