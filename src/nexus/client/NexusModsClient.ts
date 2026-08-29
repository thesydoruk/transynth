/**
 * NexusModsClient — a thin TypeScript client for the NexusMods GraphQL API v2.
 *
 * @see {@link NexusModsClientOptions} for all constructor options.
 */

import {
  GET_GAME_BY_ID_QUERY,
  GET_MOD_BY_ID_QUERY,
  GET_MODS_THIS_MOD_REQUIRES_QUERY,
  GET_MODS_REQUIRING_THIS_MOD_QUERY,
  SEARCH_MODS_BY_NAME_QUERY,
} from '../graphql';
import { NexusModsError, NexusModsNotFoundError } from '../errors';
import type {
  FindPossibleTranslationsOptions,
  GetModRelationsOptions,
  NexusGame,
  NexusMod,
  NexusModRelationsResult,
  NexusModSearchResult,
  NexusModsClientOptions,
  SearchModsByNameOptions,
  TranslationCandidate,
  TranslationSearchResult,
} from '../types';
import { graphqlRequest } from './http';
import { mapGame, mapMod } from './mapping';
import { loadRequirementConnectionSafe, mapModRequirementNodes } from './relations';
import {
  findTranslationsFromHeuristicSearch,
  findTranslationsFromOfficialRequirements,
} from './translationSearch';
import { getTranslationKeywords } from './translationKeywords';
import { scoreTranslationCandidate } from './translationScoring';
import { mergeUniqueModsByGameAndModId, normalizeLanguage, normalizeQuery } from './textUtils';
import { NEXUS_USER_AGENT } from '../userAgent';

export class NexusModsClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  public constructor(options: NexusModsClientOptions = {}) {
    this.endpoint = options.endpoint ?? 'https://api.nexusmods.com/v2/graphql';
    this.timeoutMs = options.timeoutMs ?? 30_000;

    this.headers = {
      'Content-Type': 'application/json',
      'User-Agent': options.userAgent ?? NEXUS_USER_AGENT,
      ...(options.accessToken ? { apikey: options.accessToken } : {}),
    };
  }

  public async searchModsByName(
    name: string,
    options: SearchModsByNameOptions = {},
  ): Promise<NexusModSearchResult> {
    const normalizedName = normalizeQuery(name);
    const filterClauses: unknown[] = [];

    if (normalizedName) {
      filterClauses.push({
        name: [{ value: normalizedName, op: 'WILDCARD' }],
      });
    }

    if (typeof options.gameDomainName === 'string' && options.gameDomainName.trim()) {
      filterClauses.push({
        gameDomainName: [{ value: options.gameDomainName.trim(), op: 'EQUALS' }],
      });
    }

    if (typeof options.gameId === 'number') {
      filterClauses.push({
        gameId: [{ value: options.gameId, op: 'EQUALS' }],
      });
    }

    const data = await this.request<{
      mods: { totalCount: number; nodesCount: number; nodes: unknown[] };
    }>(SEARCH_MODS_BY_NAME_QUERY, {
      filter: filterClauses.length > 0 ? { op: 'AND', filter: filterClauses } : undefined,
      offset: options.offset ?? 0,
      count: options.count ?? 20,
    });

    return {
      totalCount: data.mods.totalCount,
      nodesCount: data.mods.nodesCount,
      items: data.mods.nodes.map((item) => mapMod(item)),
    };
  }

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

    return mapGame(data.game);
  }

  public async getModById(domainName: string, gameId: number, modId: number): Promise<NexusMod> {
    const normalizedDomainName = domainName.trim();

    if (!normalizedDomainName) {
      throw new NexusModsError('The game domain name must not be empty.');
    }

    if (!Number.isInteger(modId) || modId <= 0) {
      throw new NexusModsError('The mod id must be a positive integer.');
    }

    const data = await this.request<{
      mods: { totalCount: number; nodesCount: number; nodes: unknown[] };
    }>(GET_MOD_BY_ID_QUERY, {
      domainName: normalizedDomainName,
      gameId: String(gameId),
      modId: String(modId),
    });

    const first = data.mods.nodes[0];

    if (!first) {
      throw new NexusModsNotFoundError(`Mod "${normalizedDomainName}/${modId}" was not found.`);
    }

    return mapMod(first);
  }

  public async getModRelations(
    domainName: string,
    gameId: number,
    modId: number,
    options: GetModRelationsOptions = {},
  ): Promise<NexusModRelationsResult> {
    const sourceMod = await this.getModById(domainName, gameId, modId);
    const count = Math.min(200, Math.max(1, options.count ?? 100));
    const offset = Math.max(0, options.offset ?? 0);

    const requiredByConnection = await loadRequirementConnectionSafe(
      this.request.bind(this),
      GET_MODS_REQUIRING_THIS_MOD_QUERY,
      sourceMod.game.domainName,
      gameId,
      sourceMod.modId,
      offset,
      count,
      'modsRequiringThisMod',
    );

    const requiresConnection = await loadRequirementConnectionSafe(
      this.request.bind(this),
      GET_MODS_THIS_MOD_REQUIRES_QUERY,
      sourceMod.game.domainName,
      gameId,
      sourceMod.modId,
      offset,
      count,
      'modsThisModRequires',
    );

    return {
      sourceMod,
      requires: mapModRequirementNodes(requiresConnection.nodes),
      requiredBy: mapModRequirementNodes(requiredByConnection.nodes),
    };
  }

  public async findPossibleTranslations(
    domainName: string,
    gameId: number,
    modId: number,
    options: FindPossibleTranslationsOptions = {},
  ): Promise<TranslationSearchResult> {
    const sourceMod = await this.getModById(domainName, gameId, modId);
    const language = normalizeLanguage(options.language);
    const translationKeywords = getTranslationKeywords(language);
    const requestedCount = options.count ?? 50;
    const official = await findTranslationsFromOfficialRequirements(
      this.request.bind(this),
      this.getModById.bind(this),
      sourceMod,
      gameId,
      options,
    );

    const heuristic = await findTranslationsFromHeuristicSearch(
      this.request.bind(this),
      sourceMod,
      gameId,
      language,
      options,
    );

    const candidates = mergeUniqueModsByGameAndModId([...official.items, ...heuristic]);

    const scored: TranslationCandidate[] = candidates
      .map((candidate) =>
        scoreTranslationCandidate(
          sourceMod,
          candidate,
          translationKeywords,
          language,
          options.includeDescriptionSearch ?? true,
        ),
      )
      .filter((c) => c.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.mod.updatedAt.localeCompare(a.mod.updatedAt);
      });

    const limited = scored.slice(0, requestedCount);

    return {
      sourceMod,
      totalCount: Math.max(official.totalCount, candidates.length),
      nodesCount: Math.max(official.nodesCount, candidates.length),
      items: limited,
    };
  }

  private async request<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
    return graphqlRequest<TData>({
      endpoint: this.endpoint,
      headers: this.headers,
      timeoutMs: this.timeoutMs,
      query,
      variables,
    });
  }
}
