import pg from 'pg';
import { CONFIG } from './config';
import type { GameType } from './types';
import { log } from './logger';

const { Pool } = pg;

/** A Tx is either the Pool (for standalone queries) or a PoolClient (inside a transaction). */
export type Tx = pg.Pool | pg.PoolClient;

const PG_TRANSIENT_CODES = new Set([
  '57P03', // cannot_connect_now (recovery)
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '53300', // too_many_connections
  '40P01', // deadlock_detected
  '40001', // serialization_failure
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
]);

/** True for PostgreSQL / network errors that may succeed on retry. */
export const isPgTransientError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const code = 'code' in err ? (err as { code?: string }).code : undefined;
  if (code && PG_TRANSIENT_CODES.has(code)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('connection terminated') ||
    msg.includes('not yet accepting connections') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('deadlock')
  );
};

/** Retry `fn` on transient PostgreSQL / connection errors with exponential backoff. */
export const withPgRetry = async <T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; label?: string },
): Promise<T> => {
  const maxAttempts = opts?.maxAttempts ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isPgTransientError(err) || attempt === maxAttempts - 1) throw err;
      lastErr = err;
      const delay = Math.min(500 * 2 ** attempt + Math.random() * 200, 15_000);
      log.warn(
        `DB retry ${attempt + 1}/${maxAttempts - 1}${opts?.label ? ` (${opts.label})` : ''}: ${(err as Error).message} — ${Math.round(delay)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
};

let _pool: pg.Pool | null = null;

export const openDb = (): pg.Pool => {
  if (!_pool) {
    _pool = new Pool({
      connectionString: CONFIG.databaseUrl,
      max: CONFIG.dbPoolMax,
      keepAlive: true,
      ...(CONFIG.dbStatementTimeoutMs > 0
        ? { statement_timeout: CONFIG.dbStatementTimeoutMs }
        : {}),
      ...(CONFIG.dbIdleInTransactionTimeoutMs > 0
        ? { idle_in_transaction_session_timeout: CONFIG.dbIdleInTransactionTimeoutMs }
        : {}),
    });
    _pool.on('error', (err) => {
      log.error('DB: idle pool client error', err);
    });
    log.info(`DB: connection pool created (max=${CONFIG.dbPoolMax})`);
  }
  return _pool;
};

export const closeDb = async (): Promise<void> => {
  if (_pool) {
    await _pool.end();
    _pool = null;
    log.info('DB: connection pool closed');
  }
};

export const runSchema = async (db: Tx, schemaSql: string): Promise<void> => {
  await db.query(schemaSql);
};

/**
 * Execute a function inside a transaction.
 * Acquires a client, runs BEGIN … COMMIT, releases on completion.
 */
export const withTransaction = async <T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
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
};

export const upsertMod = async (
  db: Tx,
  name: string,
  absPath: string,
  versionHash: string,
  game: GameType = 'fo4',
  nexus?: { nexusModId?: number; nexusName?: string },
): Promise<number> => {
  log.debug(`DB: upsertMod name=${name} game=${game}`);
  const { rows } = await db.query(
    `INSERT INTO mods(name, abs_path, version_hash, game, nexus_mod_id, nexus_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(name, version_hash) DO UPDATE SET
       abs_path = EXCLUDED.abs_path,
       game = EXCLUDED.game,
       nexus_mod_id = COALESCE(EXCLUDED.nexus_mod_id, mods.nexus_mod_id),
       nexus_name = COALESCE(EXCLUDED.nexus_name, mods.nexus_name)
     RETURNING id`,
    [name, absPath, versionHash, game, nexus?.nexusModId ?? null, nexus?.nexusName ?? null],
  );
  return rows[0].id;
};

export const upsertRecord = async (
  db: Tx,
  modId: number,
  signature: string,
  path: string,
  pathSimplified: string,
  edid: string | null,
  hashNorm: string | null,
  formidHex: string | null,
): Promise<number> => {
  const fid = formidHex ?? '';
  const { rows } = await db.query(
    `INSERT INTO records(mod_id, signature, path, path_simplified, edid, hash_norm, formid_hex)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(mod_id, signature, path, formid_hex) DO UPDATE SET
       path_simplified = EXCLUDED.path_simplified,
       edid = COALESCE(EXCLUDED.edid, records.edid),
       hash_norm = EXCLUDED.hash_norm
     RETURNING id`,
    [modId, signature, path, pathSimplified, edid, hashNorm, fid],
  );
  return rows[0].id;
};

export const insertString = async (
  db: Tx,
  recordId: number,
  lang: string,
  textRaw: string,
  textNorm: string,
  sourceKind = 'export',
  lstringId?: number | null,
  textNormNopunct?: string | null,
  context?: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO strings(record_id, lang, lstring_id, text_raw, text_norm, source_kind, text_norm_nopunct, context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      recordId,
      lang,
      lstringId ?? null,
      textRaw,
      textNorm,
      sourceKind,
      textNormNopunct ?? null,
      context ?? null,
    ],
  );
  return rows[0].id;
};

/**
 * Upsert a dialog topic (DIAL record) for a specific mod and return its id.
 *
 * @param db - Database handle.
 * @param modId - Parent mod id.
 * @param formidHex - DIAL FormID as 8-char uppercase hex.
 * @param edid - Optional editor id for topic labeling.
 */
export const upsertDialogTopic = async (
  db: Tx,
  modId: number,
  formidHex: string,
  edid?: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_topics(mod_id, formid_hex, edid)
     VALUES ($1, $2, $3)
     ON CONFLICT(mod_id, formid_hex) DO UPDATE
       SET edid = COALESCE(EXCLUDED.edid, dialog_topics.edid)
     RETURNING id`,
    [modId, formidHex, edid ?? null],
  );
  return rows[0].id;
};

/**
 * Upsert a dialog node (INFO record) under a topic.
 *
 * @param db - Database handle.
 * @param topicId - Parent dialog topic id.
 * @param infoFormidHex - INFO FormID as 8-char uppercase hex.
 * @param responseStringId - Source string id associated with this INFO node.
 * @param speakerFormidHex - Optional speaker NPC FormID.
 * @param speakerName - Optional resolved speaker display name.
 * @param previousInfoFormidHex - Optional previous INFO link (PNAM).
 */
export const upsertDialogNode = async (
  db: Tx,
  topicId: number,
  infoFormidHex: string,
  responseStringId: number,
  speakerFormidHex?: string | null,
  speakerName?: string | null,
  previousInfoFormidHex?: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_nodes(
       topic_id, info_formid_hex, response_string_id, speaker_formid_hex, speaker_name, previous_info_formid_hex
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(topic_id, info_formid_hex) DO UPDATE SET
       response_string_id = COALESCE(dialog_nodes.response_string_id, EXCLUDED.response_string_id),
       speaker_formid_hex = COALESCE(EXCLUDED.speaker_formid_hex, dialog_nodes.speaker_formid_hex),
       speaker_name = COALESCE(EXCLUDED.speaker_name, dialog_nodes.speaker_name),
       previous_info_formid_hex = COALESCE(EXCLUDED.previous_info_formid_hex, dialog_nodes.previous_info_formid_hex),
       updated_at = NOW()
     RETURNING id`,
    [
      topicId,
      infoFormidHex,
      responseStringId,
      speakerFormidHex ?? null,
      speakerName ?? null,
      previousInfoFormidHex ?? null,
    ],
  );
  return rows[0].id;
};

/**
 * Upsert a directed edge between two dialog INFO nodes.
 *
 * @param db - Database handle.
 * @param topicId - Parent topic id.
 * @param fromInfoFormidHex - Source INFO FormID.
 * @param toInfoFormidHex - Target INFO FormID.
 * @param edgeKind - Edge semantics (default: 'previous').
 * @param confidence - Link confidence marker (default: 'exact').
 */
export const upsertDialogEdge = async (
  db: Tx,
  topicId: number,
  fromInfoFormidHex: string,
  toInfoFormidHex: string,
  edgeKind = 'previous',
  confidence = 'exact',
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_edges(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind, confidence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind) DO UPDATE
       SET confidence = EXCLUDED.confidence
     RETURNING id`,
    [topicId, fromInfoFormidHex, toInfoFormidHex, edgeKind, confidence],
  );
  return rows[0].id;
};

/**
 * Insert or update a dialog scene record.
 *
 * @returns The `dialog_scenes.id` of the upserted row.
 */
export const upsertDialogScene = async (
  db: Tx,
  modId: number,
  formidHex: string,
  edid: string | null,
  questFormidHex: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_scenes(mod_id, formid_hex, edid, quest_formid_hex)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(mod_id, formid_hex) DO UPDATE SET
       edid = COALESCE(EXCLUDED.edid, dialog_scenes.edid),
       quest_formid_hex = COALESCE(EXCLUDED.quest_formid_hex, dialog_scenes.quest_formid_hex)
     RETURNING id`,
    [modId, formidHex, edid, questFormidHex],
  );
  return rows[0].id;
};

/**
 * Insert a scene phase linking a scene to a dialog topic at a given order.
 *
 * @returns The `dialog_scene_phases.id` of the upserted row.
 */
export const upsertDialogScenePhase = async (
  db: Tx,
  sceneId: number,
  phaseOrder: number,
  aliasId: number,
  topicId: number,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_scene_phases(scene_id, phase_order, alias_id, topic_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(scene_id, phase_order, topic_id) DO UPDATE SET
       alias_id = EXCLUDED.alias_id
     RETURNING id`,
    [sceneId, phaseOrder, aliasId, topicId],
  );
  return rows[0].id;
};

export const addTranslation = async (
  db: Tx,
  srcStringId: number,
  targetLang: string,
  text: string,
  status: string,
  confidence: number | null,
  provenance: string,
  model?: string,
): Promise<number> => {
  // One translation per (src_string_id, target_lang): upsert in place so a
  // re-import or duplicate row updates the existing translation instead of
  // creating a second one (the legacy multi-row model has been removed).
  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(src_string_id, target_lang) DO UPDATE SET
       text = EXCLUDED.text,
       status = EXCLUDED.status,
       confidence = EXCLUDED.confidence,
       provenance = EXCLUDED.provenance,
       model = EXCLUDED.model,
       updated_at = NOW()
     RETURNING id`,
    [srcStringId, targetLang, text, status, confidence, provenance, model ?? null],
  );
  return rows[0].id;
};

export const bestTranslation = async (
  db: Tx,
  srcStringId: number,
  targetLang: string,
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
};

export const findStringId = async (
  db: Tx,
  formidHex: string,
  path: string,
  lang: string,
): Promise<number | undefined> => {
  if (!formidHex) return undefined;
  const { rows } = await db.query(
    `SELECT s.id FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.formid_hex = $1 AND r.path = $2 AND s.lang = $3 LIMIT 1`,
    [formidHex, path, lang],
  );
  return rows[0]?.id;
};
