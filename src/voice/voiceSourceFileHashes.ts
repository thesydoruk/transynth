/**
 * Persisted SHA-1 of original voice files (`Sound/Voice/…` / Disco Audio/…).
 *
 * A row is trusted only while size + mtime still match the file on disk.
 * First hash is written on import / backfill. Reuse and carry-over pass
 * `trustStored` and do not stat or SHA-1 again.
 */
import fs from 'node:fs';
import type { Tx } from '../db';
import { CONFIG } from '../config';
import { log } from '../logger';
import { mapWithConcurrency } from '../utils/concurrency';
import { sha1HexFile } from '../utils/hash';

export type VoiceSourceFileRef = {
  modId: number;
  relPath: string;
  absPath: string;
};

export type StoredVoiceSourceHash = {
  sha1: string;
  fileSize: number;
  mtimeMs: number;
};

export const normalizeVoiceSourceRelPath = (relPath: string): string =>
  relPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

export const voiceSourceHashMapKey = (modId: number, relPath: string): string =>
  `${modId}:${normalizeVoiceSourceRelPath(relPath)}`;

/** Return the stored digest when size and mtime have not changed. */
export const storedVoiceSourceHashIfFresh = (
  stored: StoredVoiceSourceHash | undefined,
  fileSize: number,
  mtimeMs: number,
): string | null => {
  if (!stored) return null;
  if (stored.fileSize !== fileSize) return null;
  if (stored.mtimeMs !== mtimeMs) return null;
  return stored.sha1;
};

/** DB digest for reuse (`trustStored`) or a fresh size+mtime hit. */
export const takeStoredVoiceSourceHash = (
  stored: StoredVoiceSourceHash | undefined,
  opts: { trustStored?: boolean; fileSize?: number; mtimeMs?: number } = {},
): string | null => {
  if (!stored) return null;
  if (opts.trustStored) return stored.sha1;
  if (opts.fileSize == null || opts.mtimeMs == null) return null;
  return storedVoiceSourceHashIfFresh(stored, opts.fileSize, opts.mtimeMs);
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const loadVoiceSourceFileHashMap = async (
  db: Tx,
  modIds: number[],
): Promise<Map<string, StoredVoiceSourceHash>> => {
  const ids = [...new Set(modIds.filter((id) => id > 0))];
  if (ids.length === 0) return new Map();

  const { rows } = await db.query<{
    mod_id: number;
    rel_path: string;
    file_size: string | number;
    sha1: string;
    mtime_ms: string | number;
  }>(
    `SELECT mod_id, rel_path, file_size, sha1, mtime_ms
     FROM voice_source_file_hashes
     WHERE mod_id = ANY($1::int[])`,
    [ids],
  );

  const out = new Map<string, StoredVoiceSourceHash>();
  for (const row of rows) {
    out.set(voiceSourceHashMapKey(row.mod_id, row.rel_path), {
      sha1: row.sha1,
      fileSize: Number(row.file_size),
      mtimeMs: Number(row.mtime_ms),
    });
  }
  return out;
};

const upsertVoiceSourceFileHashes = async (
  db: Tx,
  rows: Array<VoiceSourceFileRef & StoredVoiceSourceHash>,
): Promise<void> => {
  if (rows.length === 0) return;
  for (const part of chunk(rows, CONFIG.dbChunkSize)) {
    await db.query(
      `INSERT INTO voice_source_file_hashes (mod_id, rel_path, file_size, sha1, mtime_ms)
       SELECT * FROM UNNEST(
         $1::int[], $2::text[], $3::bigint[], $4::text[], $5::bigint[]
       )
       ON CONFLICT (mod_id, rel_path) DO UPDATE SET
         file_size = EXCLUDED.file_size,
         sha1 = EXCLUDED.sha1,
         mtime_ms = EXCLUDED.mtime_ms,
         hashed_at = NOW()`,
      [
        part.map((row) => row.modId),
        part.map((row) => normalizeVoiceSourceRelPath(row.relPath)),
        part.map((row) => row.fileSize),
        part.map((row) => row.sha1),
        part.map((row) => row.mtimeMs),
      ],
    );
  }
};

export type ResolveVoiceSourceFileHashesOptions = {
  concurrency?: number;
  onHashed?: (done: number, total: number) => void;
  /**
   * Reuse / carry-over: trust a DB row and skip stat + SHA-1.
   * Import / backfill keep the default (rehash when size or mtime drifted).
   */
  trustStored?: boolean;
};

/**
 * SHA-1 for each file: DB hit when size+mtime match, otherwise hash and persist.
 * Returns a map keyed by {@link voiceSourceHashMapKey}. Missing files are omitted.
 */
export const resolveVoiceSourceFileHashes = async (
  db: Tx,
  files: VoiceSourceFileRef[],
  options: ResolveVoiceSourceFileHashesOptions = {},
): Promise<Map<string, string>> => {
  const unique = new Map<string, VoiceSourceFileRef>();
  for (const file of files) {
    if (file.modId < 1 || !file.absPath || !file.relPath) continue;
    unique.set(voiceSourceHashMapKey(file.modId, file.relPath), file);
  }
  if (unique.size === 0) return new Map();

  const stored = await loadVoiceSourceFileHashMap(
    db,
    [...unique.values()].map((file) => file.modId),
  );
  const hashes = new Map<string, string>();
  const toHash: VoiceSourceFileRef[] = [];

  for (const [key, file] of unique) {
    const row = stored.get(key);
    const trusted = takeStoredVoiceSourceHash(row, { trustStored: options.trustStored });
    if (trusted) {
      hashes.set(key, trusted);
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file.absPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size <= 0) continue;
    const mtimeMs = Math.round(stat.mtimeMs);
    const fresh = storedVoiceSourceHashIfFresh(row, stat.size, mtimeMs);
    if (fresh) {
      hashes.set(key, fresh);
      continue;
    }
    toHash.push(file);
  }

  const concurrency = Math.max(1, options.concurrency ?? 8);
  let hashed = 0;
  const computed = await mapWithConcurrency(toHash, concurrency, async (file) => {
    try {
      const stat = fs.statSync(file.absPath);
      const sha1 = await sha1HexFile(file.absPath);
      const row = {
        ...file,
        sha1,
        fileSize: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      };
      hashed += 1;
      options.onHashed?.(hashed, toHash.length);
      return row;
    } catch (err) {
      log.warn(
        `Voice source hash: skip ${file.absPath} (${err instanceof Error ? err.message : String(err)})`,
      );
      hashed += 1;
      options.onHashed?.(hashed, toHash.length);
      return null;
    }
  });

  const written: Array<VoiceSourceFileRef & StoredVoiceSourceHash> = [];
  for (const row of computed) {
    if (!row) continue;
    hashes.set(voiceSourceHashMapKey(row.modId, row.relPath), row.sha1);
    written.push(row);
  }
  if (written.length > 0) {
    await upsertVoiceSourceFileHashes(db, written);
    log.info(`Voice source hash: stored ${written.length} file digest(s)`);
  }
  return hashes;
};
