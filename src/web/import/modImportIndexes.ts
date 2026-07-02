/**
 * Drop and restore heavy pg_trgm / HASH indexes during bulk mod import.
 *
 * GIN trigram indexes on strings.text_raw / text_norm are updated on every INSERT
 * and dominate ingest time on 100k+ row mods. Dropping them for the import window
 * and rebuilding once at the end is much faster than maintaining them per row.
 */
import type { Tx } from '../../db';
import { logImport } from '../../logging/loggers';

/** Session advisory lock — only one import defers indexes at a time. */
export const MOD_IMPORT_INDEX_ADVISORY_LOCK_KEY = 0x4d6f6449;

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
