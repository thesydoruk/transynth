import { GET_MODS_REQUIRING_THIS_MOD_QUERY, SEARCH_TRANSLATION_CANDIDATES_QUERY } from '../graphql';
import type { FindPossibleTranslationsOptions, NexusMod } from '../types';
import { parsePositiveInteger } from './coercion';
import { uniqueNumbers } from './textUtils';
import type { GetModByIdFn, ModRequirementNode, NexusRequestFn } from './internalTypes';
import { mapMod } from './mapping';
import {
  buildSourceNameSearchVariants,
  extractImportantTokens,
  mergeUniqueModsByGameAndModId,
  normalizeLanguage,
} from './textUtils';
import { getTranslationKeywords } from './translationKeywords';
import { isLikelyTranslationRequirementNode } from './translationScoring';

export async function hydrateModsByIds(
  getModById: GetModByIdFn,
  domainName: string,
  gameId: number,
  ids: number[],
  limit: number,
): Promise<NexusMod[]> {
  const result: NexusMod[] = [];
  const boundedIds = ids.slice(0, limit);
  const batchSize = 8;

  for (let i = 0; i < boundedIds.length; i += batchSize) {
    const batch = boundedIds.slice(i, i + batchSize);
    const hydratedBatch = await Promise.all(
      batch.map(async (modId) => {
        try {
          return await getModById(domainName, gameId, modId);
        } catch {
          return null;
        }
      }),
    );

    result.push(...hydratedBatch.filter((mod): mod is NexusMod => mod !== null));
  }

  return result;
}

export async function findTranslationsFromOfficialRequirements(
  request: NexusRequestFn,
  getModById: GetModByIdFn,
  sourceMod: NexusMod,
  gameId: number,
  options: FindPossibleTranslationsOptions,
): Promise<{ totalCount: number; nodesCount: number; items: NexusMod[] }> {
  const requestedCount = options.count ?? 50;
  const relationCount = Math.min(300, Math.max(60, requestedCount * 6));
  const language = normalizeLanguage(options.language);
  const translationKeywords = getTranslationKeywords(language);

  const data = await request<{
    mods: {
      nodes: Array<{
        modRequirements: {
          modsRequiringThisMod: {
            totalCount: number;
            nodesCount: number;
            nodes: ModRequirementNode[];
          };
        };
      }>;
    };
  }>(GET_MODS_REQUIRING_THIS_MOD_QUERY, {
    domainName: sourceMod.game.domainName,
    gameId: String(gameId),
    modId: String(sourceMod.modId),
    offset: options.offset ?? 0,
    count: relationCount,
  });

  const relation = data.mods.nodes[0]?.modRequirements?.modsRequiringThisMod;
  if (!relation) {
    return { totalCount: 0, nodesCount: 0, items: [] };
  }

  const filteredNodes = relation.nodes.filter((node) =>
    isLikelyTranslationRequirementNode(sourceMod, node, translationKeywords, language),
  );

  const idCandidates = uniqueNumbers(
    filteredNodes
      .map((node) => parsePositiveInteger(node.modId))
      .filter((id): id is number => id !== null),
  );

  if (idCandidates.length === 0) {
    return {
      totalCount: relation.totalCount,
      nodesCount: relation.nodesCount,
      items: [],
    };
  }

  const hydrated = await hydrateModsByIds(
    getModById,
    sourceMod.game.domainName,
    gameId,
    idCandidates,
    Math.min(150, Math.max(40, requestedCount * 3)),
  );

  const withoutSource = hydrated.filter((candidate) => {
    if (options.includeOriginalMod) return true;
    return !(
      candidate.game.domainName === sourceMod.game.domainName && candidate.modId === sourceMod.modId
    );
  });

  return {
    totalCount: relation.totalCount,
    nodesCount: relation.nodesCount,
    items: withoutSource,
  };
}

export async function findTranslationsFromHeuristicSearch(
  request: NexusRequestFn,
  sourceMod: NexusMod,
  gameId: number,
  language: string | null,
  options: FindPossibleTranslationsOptions,
): Promise<NexusMod[]> {
  const requestedCount = options.count ?? 50;
  const sourceTokens = extractImportantTokens(sourceMod.name);
  const searchWindowCount = Math.min(100, Math.max(20, requestedCount * 2));
  const maxWindows = 3;
  const phraseVariants = buildSourceNameSearchVariants(sourceMod.name);

  const rootClauses: unknown[] = [
    {
      gameDomainName: [{ value: sourceMod.game.domainName, op: 'EQUALS' }],
    },
  ];

  const tokenClauses = sourceTokens.map((token) => ({
    name: [{ value: token, op: 'WILDCARD' }],
  }));

  if (tokenClauses.length > 0) {
    rootClauses.push({ op: 'OR', filter: tokenClauses });
  }

  if (language) {
    rootClauses.push({
      name: [{ value: language, op: 'WILDCARD' }],
    });
  }

  const baseOffset = options.offset ?? 0;
  const rawMods: NexusMod[] = [];

  for (let window = 0; window < maxWindows; window += 1) {
    const offset = baseOffset + window * searchWindowCount;
    const data = await request<{
      mods: { nodesCount: number; nodes: unknown[] };
    }>(SEARCH_TRANSLATION_CANDIDATES_QUERY, {
      filter: { op: 'AND', filter: rootClauses },
      offset,
      count: searchWindowCount,
    });

    rawMods.push(...data.mods.nodes.map((item) => mapMod(item)));

    if (data.mods.nodesCount < searchWindowCount) {
      break;
    }
  }

  for (const phrase of phraseVariants) {
    const data = await request<{
      mods: { nodes: unknown[] };
    }>(SEARCH_TRANSLATION_CANDIDATES_QUERY, {
      filter: {
        op: 'AND',
        filter: [
          {
            gameDomainName: [{ value: sourceMod.game.domainName, op: 'EQUALS' }],
          },
          {
            name: [{ value: phrase, op: 'WILDCARD' }],
          },
        ],
      },
      offset: 0,
      count: Math.min(80, Math.max(20, requestedCount * 2)),
    });

    rawMods.push(...data.mods.nodes.map((item) => mapMod(item)));
  }

  const uniqueRawMods = mergeUniqueModsByGameAndModId(rawMods);

  return uniqueRawMods.filter((candidate) => {
    if (options.includeOriginalMod) return true;
    return !(
      candidate.game.domainName === sourceMod.game.domainName && candidate.modId === sourceMod.modId
    );
  });
}
