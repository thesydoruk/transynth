/**
 * Drop and restore heavy search / vector indexes during bulk mod import and delete.
 *
 * GIN trigram indexes on strings.text_raw / text_norm are updated on every INSERT/DELETE
 * and dominate ingest and purge time on 100k+ row mods. Dropping them for the bulk window
 * and rebuilding once at the end is much faster than maintaining them per row.
 */
import pg from 'pg';
import type { Tx } from '../../db';
import { logImport } from '../../logging/loggers';

const { Pool } = pg;

/** Session advisory lock — only one import defers indexes at a time. */
export const MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY = 0x4d6f6449;

/** Session advisory lock — serializes bulk writes to records/strings across imports. */
export const MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY = 0x4d6f6457;

/** True for PostgreSQL deadlock error (SQLSTATE 40P01). */
export const isPgDeadlockError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  if ('code' in err && (err as { code?: string }).code === '40P01') return true;
  return err.message.toLowerCase().includes('deadlock');
};

/**
 * Hold an exclusive session lock for the duration of a bulk import.
 * Concurrent mod/EET/CSV imports block here instead of deadlocking in PostgreSQL.
 */
export const withModImportWriteLock = async <T>(db: Tx, fn: () => Promise<T>): Promise<T> => {
  await db.query(`SELECT pg_advisory_lock($1)`, [MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await db.query(`SELECT pg_advisory_unlock($1)`, [MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY]);
  }
};

export type DeferredImportIndex = {
  name: string;
  createSql: string;
};

/** Indexes dropped before bulk ingest; DDL mirrors sql/schema.sql. */
export const DEFERRED_IMPORT_INDEXES: readonly DeferredImportIndex[] = [
  {
    name: 'idx_strings_trgm_text_norm',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_norm ON strings USING GIN(text_norm gin_trgm_ops)',
  },
  {
    name: 'idx_strings_trgm_text_raw',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_raw ON strings USING GIN (text_raw gin_trgm_ops)',
  },
  {
    name: 'idx_strings_text_norm',
    createSql: 'CREATE INDEX IF NOT EXISTS idx_strings_text_norm ON strings USING HASH(text_norm)',
  },
  {
    name: 'idx_strings_text_norm_nopunct',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_strings_text_norm_nopunct ON strings USING HASH(text_norm_nopunct)',
  },
  {
    name: 'idx_records_trgm_signature',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_signature ON records USING GIN (signature gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_formid',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_formid ON records USING GIN (formid_hex gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_edid',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_edid ON records USING GIN (edid gin_trgm_ops)',
  },
  {
    name: 'idx_records_trgm_path',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_records_trgm_path ON records USING GIN (path gin_trgm_ops)',
  },
  {
    name: 'idx_translations_trgm_text',
    createSql:
      'CREATE INDEX IF NOT EXISTS idx_translations_trgm_text ON translations USING GIN (text gin_trgm_ops)',
  },
] as const;

/** RAG vector index — per-row DELETE maintenance is very slow on large mods. */
export const TRANSLATION_EXAMPLES_HNSW_INDEX = {
  name: 'idx_translation_examples_hnsw',
  createSql:
    'CREATE INDEX IF NOT EXISTS idx_translation_examples_hnsw ON translation_examples USING hnsw (embedding vector_cosine_ops)',
} as const;

export const deferredImportIndexDropSql = (): string =>
  `DROP INDEX IF EXISTS ${DEFERRED_IMPORT_INDEXES.map((idx) => idx.name).join(', ')}`;

/**
 * Try to acquire the deferral lock and drop heavy indexes.
 * Returns false when another session already holds the lock (import proceeds normally).
 */
export const tryBeginDeferredImportIndexes = async (db: Tx): Promise<boolean> => {
  const { rows } = await db.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS acquired`,
    [MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY],
  );
  if (!rows[0]?.acquired) {
    logImport.warn(
      '[ModImport] Skipping index deferral — another bulk import is already deferring search indexes',
    );
    return false;
  }

  const started = Date.now();
  await db.query(deferredImportIndexDropSql());
  logImport.info(
    `[ModImport] Dropped ${DEFERRED_IMPORT_INDEXES.length} deferred search indexes (${Date.now() - started}ms)`,
  );
  return true;
};

/** Recreate deferred indexes and release the advisory lock. */
export const restoreDeferredImportIndexes = async (db: Tx): Promise<void> => {
  const started = Date.now();
  for (const idx of DEFERRED_IMPORT_INDEXES) {
    const indexStarted = Date.now();
    await db.query(idx.createSql);
    logImport.info(`[ModImport] Restored index ${idx.name} (${Date.now() - indexStarted}ms)`);
  }
  await db.query(`SELECT pg_advisory_unlock($1)`, [MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY]);
  logImport.info(
    `[ModImport] Restored ${DEFERRED_IMPORT_INDEXES.length} deferred search indexes (${Date.now() - started}ms total)`,
  );
};

/** Release lock without rebuilding (used when drop never ran). */
export const releaseDeferredImportIndexLock = async (db: Tx): Promise<void> => {
  await db.query(`SELECT pg_advisory_unlock($1)`, [MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY]);
};

export const dropTranslationExamplesHnswIndex = async (db: Tx): Promise<void> => {
  const started = Date.now();
  await db.query(`DROP INDEX IF EXISTS ${TRANSLATION_EXAMPLES_HNSW_INDEX.name}`);
  logImport.info(
    `[BulkWrite] Dropped ${TRANSLATION_EXAMPLES_HNSW_INDEX.name} (${Date.now() - started}ms)`,
  );
};

export const restoreTranslationExamplesHnswIndex = async (db: Tx): Promise<void> => {
  const started = Date.now();
  await db.query(TRANSLATION_EXAMPLES_HNSW_INDEX.createSql);
  logImport.info(
    `[BulkWrite] Restored ${TRANSLATION_EXAMPLES_HNSW_INDEX.name} (${Date.now() - started}ms)`,
  );
};

export type DeferredBulkWriteIndexContext = {
  searchIndexesDeferred: boolean;
  hnswDropped: boolean;
};

/** Hold one pool client for the whole bulk window (index drop → writes → restore). */
export const pinDbClient = async (
  db: Tx,
): Promise<{ client: pg.PoolClient; release?: () => void }> => {
  if (db instanceof Pool) {
    const client = await db.connect();
    return { client, release: () => client.release() };
  }
  return { client: db as pg.PoolClient };
};

/**
 * Serialize bulk mod writes, optionally drop heavy indexes + RAG HNSW, run `fn`, then restore.
 * Used by mod delete; import uses the lower-level helpers directly on a pinned client.
 */
export const withDeferredBulkModWriteIndexes = async <T>(
  db: Tx,
  enabled: boolean,
  fn: (client: Tx, ctx: DeferredBulkWriteIndexContext) => Promise<T>,
): Promise<T> => {
  const { client, release } = await pinDbClient(db);
  try {
    return await withModImportWriteLock(client, async () => {
      let searchIndexesDeferred = false;
      let hnswDropped = false;
      if (enabled) {
        searchIndexesDeferred = await tryBeginDeferredImportIndexes(client);
        await dropTranslationExamplesHnswIndex(client);
        hnswDropped = true;
      }

      try {
        return await fn(client, { searchIndexesDeferred, hnswDropped });
      } finally {
        if (hnswDropped) {
          try {
            await restoreTranslationExamplesHnswIndex(client);
          } catch (err) {
            logImport.error(
              `[BulkWrite] Failed to restore RAG HNSW index: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }
        }
        if (searchIndexesDeferred) {
          try {
            await restoreDeferredImportIndexes(client);
          } catch (err) {
            logImport.error(
              `[BulkWrite] Failed to restore deferred search indexes: ${err instanceof Error ? err.message : String(err)}`,
            );
            try {
              await releaseDeferredImportIndexLock(client);
            } catch {
              /* ignore unlock failure */
            }
            throw err;
          }
        }
      }
    });
  } finally {
    release?.();
  }
};

/**
 * Run `fn` with deferred indexes when `enabled` is true.
 * Indexes are always restored (or lock released) in `finally`.
 */
export const withDeferredImportIndexes = async <T>(
  db: Tx,
  enabled: boolean,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!enabled) return fn();

  let deferred = false;
  try {
    deferred = await tryBeginDeferredImportIndexes(db);
    return await fn();
  } finally {
    if (deferred) {
      try {
        await restoreDeferredImportIndexes(db);
      } catch (err) {
        logImport.error(
          `[ModImport] Failed to restore deferred search indexes: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          await releaseDeferredImportIndexLock(db);
        } catch {
          /* ignore unlock failure */
        }
        throw err;
      }
    }
  }
};
