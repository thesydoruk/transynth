import type { FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createNexusClient, NexusModsNotFoundError } from '../../../nexus/index';
import { CONFIG } from '../../../config';
import {
  ensureModStorageDir,
  modNexusDownloadTempPath,
  modUploadedFilePath,
} from '../../../modStorage';
import type { GameInfo } from './catalogue';

const NEXUS_KEY_MISSING = {
  error: 'NEXUS_API_KEY is not configured on the server',
  code: 'nexus_api_key_missing',
} as const;

/** Respond with 503 when the Nexus personal API key is absent. */
export const sendNexusKeyMissing = (reply: FastifyReply) => reply.code(503).send(NEXUS_KEY_MISSING);

/**
 * A single Nexus file attachment returned by v1 files endpoint.
 *
 * We intentionally normalize only the fields needed by the UI and keep the
 * shape stable regardless of minor upstream response changes.
 */
export interface NexusFileAttachment {
  fileId: number;
  name: string;
  version: string | null;
  categoryName: string | null;
  isPrimary: boolean;
  uploadedTime: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  description: string | null;
}

interface NexusDownloadLinkRow {
  URI?: string;
  uri?: string;
}

/**
 * Minimal normalized shape for a Nexus mod object returned to the frontend.
 *
 * This matches the frontend `NexusModItem` contract used on the mod details
 * and likely-translations pages.
 */
export interface NexusModView {
  id: number;
  modId: number;
  uid: string;
  name: string;
  summary: string;
  description: string;
  version: string;
  category: string;
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
  game: {
    id: number;
    name: string;
    domainName: string;
    genre: string | null;
    forumUrl: string | null;
    modCount: number | null;
    downloadCount: string | null;
    uniqueDownloadCount: string | null;
  };
  uploader: { memberId: number | null; name: string } | null;
  tags: string[];
}

/**
 * A single requirement relation item returned to the frontend.
 */
export interface NexusModRequirementView {
  modId: number;
  modName: string;
  notes: string | null;
  externalRequirement: boolean;
}

/**
 * Lazily-initialised singleton NexusMods client.
 *
 * A single instance is reused across all requests to avoid re-reading the
 * config and re-creating the HTTP headers on every call.  The instance is
 * created only when the first NexusMods-backed endpoint is hit, so startup
 * is not affected when no NexusMods calls are made.
 *
 * Initialisation is deferred rather than done at module load time so that
 * config (including NEXUS_API_KEY) is guaranteed to be resolved first.
 */
let _nexus: ReturnType<typeof createNexusClient> | null = null;

export const getNexus = () => {
  _nexus ??= createNexusClient();
  return _nexus;
};

/**
 * Fetches a single mod from Nexus REST v1 endpoint.
 *
 * Endpoint:
 *   GET https://api.nexusmods.com/v1/games/:domain/mods/:modId.json
 */
export const fetchNexusModInfo = async (
  domainName: string,
  modId: number,
): Promise<Record<string, unknown>> => {
  const key = CONFIG.nexusApiKey;
  if (!key) {
    throw new Error('NEXUS_API_KEY is not configured on the server');
  }

  const url = `https://api.nexusmods.com/v1/games/${domainName}/mods/${modId}.json`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      'User-Agent': 'storywealth-localizer/1.0',
    },
  });

  if (res.status === 404) {
    throw new NexusModsNotFoundError(`Mod "${domainName}/${modId}" was not found.`);
  }
  if (!res.ok) {
    throw new Error(`Nexus mod info API returned HTTP ${res.status}`);
  }

  return (await res.json()) as Record<string, unknown>;
};

/**
 * Maps REST v1 mod payload into the frontend-facing normalized shape.
 */
export const mapRestModToView = (raw: Record<string, unknown>, game: GameInfo): NexusModView => {
  const n = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const sn = (v: unknown): string | null => {
    const value = s(v).trim();
    return value ? value : null;
  };

  const user = (raw.user ?? null) as Record<string, unknown> | null;
  const memberId = user ? n(user.member_id) : 0;

  return {
    id: n(raw.uid) || n(raw.mod_id),
    modId: n(raw.mod_id),
    uid: String(raw.uid ?? raw.mod_id ?? ''),
    name: s(raw.name),
    summary: s(raw.summary),
    description: s(raw.description),
    version: s(raw.version),
    category: String(raw.category_id ?? ''),
    status: s(raw.status),
    author: sn(raw.author),
    createdAt: s(raw.created_time),
    updatedAt: s(raw.updated_time),
    downloads: n(raw.mod_downloads),
    endorsements: n(raw.endorsement_count),
    adultContent:
      typeof raw.contains_adult_content === 'boolean' ? raw.contains_adult_content : null,
    pictureUrl: sn(raw.picture_url),
    thumbnailUrl: sn(raw.picture_url),
    gameId: game.nexusId,
    game: {
      id: game.nexusId,
      name: game.name,
      domainName: game.domainName,
      genre: null,
      forumUrl: null,
      modCount: null,
      downloadCount: null,
      uniqueDownloadCount: null,
    },
    uploader: {
      memberId: memberId || null,
      name: s(raw.uploaded_by) || s(raw.author),
    },
    tags: [],
  };
};

/**
 * Fetches the attached file list for a Nexus mod using the REST v1 endpoint.
 *
 * Endpoint:
 *   GET https://api.nexusmods.com/v1/games/:domain/mods/:modId/files.json
 *
 * Auth:
 *   Header `apikey: <NEXUS_API_KEY>`
 *
 * @param domainName - Nexus game domain name, e.g. `fallout4`
 * @param modId - Nexus public mod ID
 * @returns Normalized file attachments array (possibly empty)
 */
export const fetchNexusModFiles = async (
  domainName: string,
  modId: number,
): Promise<NexusFileAttachment[]> => {
  const key = CONFIG.nexusApiKey;
  if (!key) {
    throw new Error('NEXUS_API_KEY is not configured on the server');
  }

  const url = `https://api.nexusmods.com/v1/games/${domainName}/mods/${modId}/files.json`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      'User-Agent': 'storywealth-localizer/1.0',
    },
  });

  if (!res.ok) {
    throw new Error(`Nexus files API returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as { files?: unknown[] };
  const files = Array.isArray(json.files) ? json.files : [];

  return files.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const n = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim()) {
        const parsed = Number(v);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

    return {
      fileId: n(row.file_id) ?? 0,
      name: s(row.name) ?? 'Unnamed file',
      version: s(row.version),
      categoryName: s(row.category_name),
      isPrimary: row.is_primary === true,
      uploadedTime: s(row.uploaded_time),
      sizeBytes: n(row.size_in_bytes),
      fileName: s(row.file_name),
      description: s(row.description),
    } satisfies NexusFileAttachment;
  });
};

/**
 * Resolves a direct CDN download URL for a Nexus file.
 */
export const fetchNexusFileDownloadUrl = async (
  domainName: string,
  modId: number,
  fileId: number,
): Promise<string> => {
  const key = CONFIG.nexusApiKey;
  if (!key) {
    throw new Error('NEXUS_API_KEY is not configured on the server');
  }

  const url = `https://api.nexusmods.com/v1/games/${domainName}/mods/${modId}/files/${fileId}/download_link.json`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      'User-Agent': 'storywealth-localizer/1.0',
    },
  });

  if (!res.ok) {
    throw new Error(`Nexus download-link API returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as NexusDownloadLinkRow[];
  const first = Array.isArray(json) ? json[0] : null;
  const link = first?.URI ?? first?.uri ?? null;
  if (!link) {
    throw new Error('Nexus download link is unavailable for this file');
  }

  return link;
};

/**
 * Downloads a Nexus file into the mod uploads directory.
 */
export const downloadNexusFileToDisk = async (
  domainName: string,
  modId: number,
  fileId: number,
  fileName: string,
): Promise<string> => {
  ensureModStorageDir();

  const safeFileName = path.basename(fileName);
  const finalPath = modUploadedFilePath(safeFileName);
  const tempPath = modNexusDownloadTempPath();
  const downloadUrl = await fetchNexusFileDownloadUrl(domainName, modId, fileId);
  const res = await fetch(downloadUrl, { redirect: 'follow' });

  if (!res.ok || !res.body) {
    throw new Error(`Nexus file download returned HTTP ${res.status}`);
  }

  try {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tempPath));
    fs.renameSync(tempPath, finalPath);
    return finalPath;
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    throw error;
  }
};
