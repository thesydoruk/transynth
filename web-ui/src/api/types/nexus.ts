/**
 * A mod record returned by the NexusMods GraphQL API v2.
 * Matches NexusMod in src/nexus/types.ts (shapes are kept in sync).
 */
export type NexusModItem = {
  id: number;
  modId: number;
  uid: string;
  name: string;
  summary: string;
  description?: string;
  category?: string;
  version: string;
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
  game: { id: number; name: string; domainName: string };
  uploader: { memberId: number | null; name: string } | null;
  tags: string[];
};

/** A single attached archive/file for a Nexus mod. */
export type NexusModFile = {
  fileId: number;
  name: string;
  version: string | null;
  categoryName: string | null;
  isPrimary: boolean;
  uploadedTime: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  description: string | null;
};

/** Compound response for mod details page. */
export type NexusModDetails = {
  mod: NexusModItem;
  files: NexusModFile[];
};

/** Paginated NexusMods mod search result from GET /api/games/:gameId/nexus/mods */
export type NexusModsPage = {
  totalCount: number;
  nodesCount: number;
  items: NexusModItem[];
};

/** A scored translation candidate from GET /api/games/:gameId/nexus/translations */
export type NexusTranslationCandidate = {
  mod: NexusModItem;
  /** Heuristic relevance score — higher is more likely a translation */
  score: number;
  /** Human-readable scoring reason tags, e.g. ["same-game", "title-contains-translation"] */
  reasons: string[];
};

/** Full result from GET /api/games/:gameId/nexus/translations */
export type NexusTranslationsResult = {
  sourceMod: NexusModItem;
  totalCount: number;
  nodesCount: number;
  /** Candidates sorted by score descending. Score-0 entries are excluded. */
  items: NexusTranslationCandidate[];
};

/** One Nexus mod relation entry from mod requirements data. */
export type NexusModRelationItem = {
  modId: number;
  modName: string;
  notes: string | null;
  externalRequirement: boolean;
};

/** Full relation payload for one source mod. */
export type NexusModRelationsResult = {
  sourceMod: NexusModItem;
  requires: NexusModRelationItem[];
  requiredBy: NexusModRelationItem[];
};
