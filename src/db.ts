import pg from 'pg';
import { CONFIG } from './config';
import type { GameType } from './types';
import { log } from './logger';

const { Pool } = pg;

/** A Tx is either the Pool (for standalone queries) or a PoolClient (inside a transaction). */
export type Tx = pg.Pool | pg.PoolClient;

let _pool: pg.Pool | null = null;

export const openDb = (): pg.Pool => {
  if (!_pool) {
    _pool = new Pool({
      connectionString: CONFIG.databaseUrl,
      max: CONFIG.dbPoolMax,
      ...(CONFIG.dbStatementTimeoutMs > 0
        ? { statement_timeout: CONFIG.dbStatementTimeoutMs }
        : {}),
      ...(CONFIG.dbIdleInTransactionTimeoutMs > 0
        ? { idle_in_transaction_session_timeout: CONFIG.dbIdleInTransactionTimeoutMs }
        : {}),
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
  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(src_string_id, target_lang, md5(text)) DO NOTHING
     RETURNING id`,
    [srcStringId, targetLang, text, status, confidence, provenance, model ?? null],
  );
  if (rows.length > 0) return rows[0].id;
  // ON CONFLICT DO NOTHING — fetch existing
  const { rows: existing } = await db.query(
    `SELECT id FROM translations WHERE src_string_id = $1 AND target_lang = $2 AND md5(text) = md5($3)`,
    [srcStringId, targetLang, text],
  );
  return existing[0]?.id ?? 0;
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
