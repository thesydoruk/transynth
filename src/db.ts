import pg from 'pg';
import { CONFIG } from './config.js';
import { log } from './logger.js';

const { Pool } = pg;

/** A Tx is either the Pool (for standalone queries) or a PoolClient (inside a transaction). */
export type Tx = pg.Pool | pg.PoolClient;

let _pool: pg.Pool | null = null;

export const openDb = (): pg.Pool => {
  if (!_pool) {
    _pool = new Pool({ connectionString: CONFIG.databaseUrl });
    log.info('DB: connection pool created');
  }
  return _pool;
}

export const closeDb = async (): Promise<void> => {
  if (_pool) {
    await _pool.end();
    _pool = null;
    log.info('DB: connection pool closed');
  }
}

export const runSchema = async (db: Tx, schemaSql: string): Promise<void> => {
  await db.query(schemaSql);
}

/**
 * Execute a function inside a transaction.
 * Acquires a client, runs BEGIN … COMMIT, releases on completion.
 */
export const withTransaction = async <T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    log.trace('DB: BEGIN transaction');
    const result = await fn(client);
    await client.query('COMMIT');
    log.trace('DB: COMMIT transaction');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    log.warn('DB: ROLLBACK transaction', err);
    throw err;
  } finally {
    client.release();
  }
}

export const upsertMod = async (db: Tx, name: string, absPath: string, versionHash: string): Promise<number> => {
  log.debug(`DB: upsertMod name=${name}`);
  const { rows } = await db.query(
    `INSERT INTO mods(name, abs_path, version_hash) VALUES ($1, $2, $3)
     ON CONFLICT(name, version_hash) DO UPDATE SET abs_path = EXCLUDED.abs_path
     RETURNING id`,
    [name, absPath, versionHash],
  );
  return rows[0].id;
}

export const upsertRecord = async (
  db: Tx, modId: number, signature: string, path: string, pathSimplified: string,
  edid: string | null, hashNorm: string | null, formidHex: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO records(mod_id, signature, path, path_simplified, edid, hash_norm, formid_hex)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(mod_id, signature, path) DO UPDATE SET
       path_simplified = EXCLUDED.path_simplified,
       edid = COALESCE(EXCLUDED.edid, records.edid),
       hash_norm = EXCLUDED.hash_norm,
       formid_hex = COALESCE(EXCLUDED.formid_hex, records.formid_hex)
     RETURNING id`,
    [modId, signature, path, pathSimplified, edid, hashNorm, formidHex],
  );
  return rows[0].id;
}

export const insertString = async (
  db: Tx,
  recordId: number,
  lang: string,
  textRaw: string,
  textNorm: string,
  sourceKind = 'export',
  lstringId?: number | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO strings(record_id, lang, lstring_id, text_raw, text_norm, source_kind) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [recordId, lang, lstringId ?? null, textRaw, textNorm, sourceKind],
  );
  return rows[0].id;
}

export const addTranslation = async (
  db: Tx, srcStringId: number, targetLang: string, text: string,
  status: string, confidence: number | null, provenance: string, model?: string,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(src_string_id, target_lang, text) DO NOTHING
     RETURNING id`,
    [srcStringId, targetLang, text, status, confidence, provenance, model ?? null],
  );
  if (rows.length > 0) return rows[0].id;
  // ON CONFLICT DO NOTHING — fetch existing
  const { rows: existing } = await db.query(
    `SELECT id FROM translations WHERE src_string_id = $1 AND target_lang = $2 AND text = $3`,
    [srcStringId, targetLang, text],
  );
  return existing[0]?.id ?? 0;
}

export const bestTranslation = async (
  db: Tx, srcStringId: number, targetLang: string,
): Promise<{ id: number; text: string; status: string } | undefined> => {
  const { rows } = await db.query(
    `SELECT id, text, status FROM translations
     WHERE src_string_id = $1 AND target_lang = $2
     ORDER BY CASE status
       WHEN 'human' THEN 1
       WHEN 'tm'    THEN 2
       WHEN 'fuzzy' THEN 3
       WHEN 'auto'  THEN 4
       ELSE 5 END,
       COALESCE(confidence, 0) DESC,
       created_at DESC
     LIMIT 1`,
    [srcStringId, targetLang],
  );
  return rows[0];
}

export const findStringId = async (
  db: Tx, formidHex: string, path: string, lang: string,
): Promise<number | undefined> => {
  if (!formidHex) return undefined;
  const { rows } = await db.query(
    `SELECT s.id FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.formid_hex = $1 AND r.path = $2 AND s.lang = $3 LIMIT 1`,
    [formidHex, path, lang],
  );
  return rows[0]?.id;
}
