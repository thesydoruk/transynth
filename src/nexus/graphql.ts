/**
 * NexusMods GraphQL v2 query strings.
 *
 * All queries target the Nexus Mods GraphQL API v2 endpoint:
 *   https://api.nexusmods.com/v2/graphql
 *
 * Type names used in variable declarations (e.g. `ModsFilter`, `ModsSort`)
 * match the NexusMods v2 schema as of the time of writing. If the schema
 * changes, update the type names here to match. Field-level changes will
 * surface as GraphQL validation errors from the server.
 *
 * The `MOD_FIELDS` constant is an internal shared selection set embedded via
 * template literal interpolation — it avoids duplicating the same 30+ fields
 * across multiple query strings. It is not exported because it is not a valid
 * standalone query string.
 */

/**
 * Shared field selection for a full mod node.
 *
 * Covers all fields that `NexusModsClient.mapMod` expects to find on a raw
 * API node. Any field added to `NexusMod` in types.ts must also appear here.
 */
const MOD_FIELDS = `
      id
      modId
      uid
      name
      summary
      description
      version
      category
      status
      author
      createdAt
      updatedAt
      downloads
      endorsements
      adultContent
      pictureUrl
      thumbnailUrl
      gameId
      game {
        id
        name
        domainName
        genre
        forumUrl
        modCount
        downloadCount
        uniqueDownloadCount
      }
      uploader {
        memberId
        name
      }
      tags {
        name
      }
`;

/**
 * Fetches a single game record by its numeric Nexus game ID.
 *
 * Variables: `{ id: Int! }`
 *
 * Response shape:
 * ```json
 * { "data": { "game": { ... } } }
 * ```
 */
export const GET_GAME_BY_ID_QUERY = `
  query GetGameById($id: Int!) {
    game(id: $id) {
      id
      name
      domainName
      genre
      forumUrl
      modCount
      downloadCount
      uniqueDownloadCount
    }
  }
`;

/**
 * Searches mods using an arbitrary filter object, with pagination and sort.
 *
 * Variables:
 * - `filter: ModsFilter` — filter tree (op: AND/OR, nested clauses)
 * - `offset: Int` — pagination offset (default 0)
 * - `count: Int` — page size
 * - `sort: [ModsSort!]` — sort criteria array
 *
 * Response shape:
 * ```json
 * { "data": { "mods": { "totalCount": 0, "nodesCount": 0, "nodes": [...] } } }
 * ```
 */
export const SEARCH_MODS_BY_NAME_QUERY = `
  query SearchModsByName(
    $filter: ModsFilter
    $offset: Int
    $count: Int
  ) {
    mods(filter: $filter, offset: $offset, count: $count) {
      totalCount
      nodesCount
      nodes {
        ${MOD_FIELDS}
      }
    }
  }
`;

/**
 * Fetches a single mod by its game domain name and numeric mod ID.
 *
 * The NexusMods v2 API does not have a dedicated `mod(domainName, modId)`
 * query, so this uses the general `mods(filter: ...)` query with an AND filter
 * that combines `gameDomainName` and `modId` equality checks, limited to one
 * result.
 *
 * Variables: `{ domainName: String!, modId: Int! }`
 *
 * Response shape:
 * ```json
 * { "data": { "mods": { "totalCount": 0, "nodesCount": 0, "nodes": [...] } } }
 * ```
 */
export const GET_MOD_BY_ID_QUERY = `
  query GetModById($domainName: String!, $gameId: String!, $modId: String!) {
    mods(
      filter: {
        gameDomainName: [{ value: $domainName, op: EQUALS }]
        gameId: [{ value: $gameId, op: EQUALS }]
        modId: [{ value: $modId, op: EQUALS }]
      }
      offset: 0
      count: 1
    ) {
      totalCount
      nodesCount
      nodes {
        ${MOD_FIELDS}
      }
    }
  }
`;

/**
 * Searches for translation candidate mods using a broad filter, without sort.
 *
 * Used by `findPossibleTranslations` which applies its own heuristic scoring
 * and ranking on the results, making server-side sort unnecessary.
 *
 * Variables:
 * - `filter: ModsFilter` — filter tree built from source mod tokens + language
 * - `offset: Int` — pagination offset
 * - `count: Int` — max raw candidates to fetch (higher = better coverage)
 *
 * Response shape:
 * ```json
 * { "data": { "mods": { "totalCount": 0, "nodesCount": 0, "nodes": [...] } } }
 * ```
 */
export const SEARCH_TRANSLATION_CANDIDATES_QUERY = `
  query SearchTranslationCandidates(
    $filter: ModsFilter
    $offset: Int
    $count: Int
  ) {
    mods(filter: $filter, offset: $offset, count: $count) {
      totalCount
      nodesCount
      nodes {
        ${MOD_FIELDS}
      }
    }
  }
`;

/**
 * Fetches the official Nexus relation list of mods that require a source mod.
 *
 * This relation is the closest API-level equivalent to the website block
 * "Translations available on the Nexus". It can contain non-translation mods
 * as well (patches, overhauls), so callers should apply additional filtering.
 *
 * Variables:
 * - `domainName: String!` — source mod game domain name
 * - `gameId: String!` — source mod game ID
 * - `modId: String!` — source mod public mod ID
 * - `offset: Int` — nested relation pagination offset
 * - `count: Int` — nested relation page size
 */
export const GET_MODS_REQUIRING_THIS_MOD_QUERY = `
  query GetModsRequiringThisMod(
    $domainName: String!
    $gameId: String!
    $modId: String!
    $offset: Int
    $count: Int
  ) {
    mods(
      filter: {
        gameDomainName: [{ value: $domainName, op: EQUALS }]
        gameId: [{ value: $gameId, op: EQUALS }]
        modId: [{ value: $modId, op: EQUALS }]
      }
      offset: 0
      count: 1
    ) {
      nodes {
        modId
        name
        modRequirements {
          modsRequiringThisMod(offset: $offset, count: $count) {
            totalCount
            nodesCount
            nodes {
              modId
              modName
              notes
              externalRequirement
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetches the official Nexus relation list of mods required by a source mod.
 *
 * This relation powers the website block usually labeled as requirements
 * (dependencies the source mod needs in order to work).
 *
 * Variables:
 * - `domainName: String!` — source mod game domain name
 * - `gameId: String!` — source mod game ID
 * - `modId: String!` — source mod public mod ID
 * - `offset: Int` — nested relation pagination offset
 * - `count: Int` — nested relation page size
 */
export const GET_MODS_THIS_MOD_REQUIRES_QUERY = `
  query GetModsThisModRequires(
    $domainName: String!
    $gameId: String!
    $modId: String!
    $offset: Int
    $count: Int
  ) {
    mods(
      filter: {
        gameDomainName: [{ value: $domainName, op: EQUALS }]
        gameId: [{ value: $gameId, op: EQUALS }]
        modId: [{ value: $modId, op: EQUALS }]
      }
      offset: 0
      count: 1
    ) {
      nodes {
        modId
        name
        modRequirements {
          modsThisModRequires(offset: $offset, count: $count) {
            totalCount
            nodesCount
            nodes {
              modId
              modName
              notes
              externalRequirement
            }
          }
        }
      }
    }
  }
`;
