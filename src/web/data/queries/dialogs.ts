import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { BEST_TRANSLATION_ORDER } from './constants';

export type DialogTopicRow = {
  topic_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_count: number;
};

export type DialogTreeNodeRow = {
  node_id: number;
  info_formid_hex: string;
  previous_info_formid_hex: string | null;
  speaker_formid_hex: string | null;
  speaker_name: string | null;
  string_id: number | null;
  source: string | null;
  context: string | null;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
};

export type DialogTreeEdgeRow = {
  edge_id: number;
  from_info_formid_hex: string;
  to_info_formid_hex: string;
  edge_kind: string;
  confidence: string;
};

/**
 * List dialog topics available for a mod.
 *
 * @param db - Database handle.
 * @param modId - Mod id.
 */
export const listDialogTopics = async (db: Tx, modId: number): Promise<DialogTopicRow[]> => {
  const { rows } = await db.query(
    `SELECT
       dt.id AS topic_id,
       dt.formid_hex AS topic_formid_hex,
       dt.edid AS topic_edid,
       COUNT(dn.id)::int AS node_count
     FROM dialog_topics dt
     LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
     WHERE dt.mod_id = $1
     GROUP BY dt.id, dt.formid_hex, dt.edid
     ORDER BY node_count DESC, dt.formid_hex ASC`,
    [modId],
  );
  return rows as DialogTopicRow[];
};

/**
 * Load a full dialog tree payload (nodes + edges) for a topic id.
 *
 * @param db - Database handle.
 * @param topicId - Dialog topic id.
 * @param srcLang - Source language for node text.
 * @param targetLang - Target language for best-translation join.
 */
export const getDialogTree = async (
  db: Tx,
  topicId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ nodes: DialogTreeNodeRow[]; edges: DialogTreeEdgeRow[] }> => {
  const { rows: nodeRows } = await db.query(
    `SELECT
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.previous_info_formid_hex,
       dn.speaker_formid_hex,
       dn.speaker_name,
       s.id AS string_id,
       s.text_raw AS source,
       s.context,
       t.id AS translation_id,
       t.text AS translation,
       t.status,
       t.confidence,
       t.provenance,
       t.model,
       t.updated_at,
       COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM dialog_nodes dn
     LEFT JOIN strings s
       ON s.id = dn.response_string_id
      AND s.lang = $2
     LEFT JOIN translations t
       ON t.src_string_id = s.id
      AND t.target_lang = $3
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $3
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
        LIMIT 1
      )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id
         AND qi.target_lang = $3
         AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE dn.topic_id = $1
     ORDER BY dn.id ASC`,
    [topicId, srcLang, targetLang],
  );

  const { rows: edgeRows } = await db.query(
    `SELECT
       de.id AS edge_id,
       de.from_info_formid_hex,
       de.to_info_formid_hex,
       de.edge_kind,
       de.confidence
     FROM dialog_edges de
     WHERE de.topic_id = $1
     ORDER BY de.id ASC`,
    [topicId],
  );

  return {
    nodes: nodeRows as DialogTreeNodeRow[],
    edges: edgeRows as DialogTreeEdgeRow[],
  };
};

// ── Scene-based dialog queries ──────────────────────────────────────────────

export type DialogSceneRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  quest_formid_hex: string | null;
  phase_count: number;
};

export type DialogConversationRow = {
  conversation_key: string;
  quest_formid_hex: string | null;
  sample_scene_edid: string | null;
  sample_scene_formid_hex: string;
  scene_count: number;
  phase_count: number;
};

/**
 * List all dialog scenes for a mod, ordered by phase count descending.
 */
export const listDialogScenes = async (db: Tx, modId: number): Promise<DialogSceneRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       ds.quest_formid_hex,
       COUNT(dsp.id)::int AS phase_count
     FROM dialog_scenes ds
     LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     WHERE ds.mod_id = $1
     GROUP BY ds.id, ds.formid_hex, ds.edid, ds.quest_formid_hex
     ORDER BY phase_count DESC, ds.formid_hex ASC`,
    [modId],
  );
  return rows as DialogSceneRow[];
};

/**
 * List aggregated conversation groups.
 *
 * A conversation groups all scenes that belong to the same quest. Scenes
 * without a quest owner become single-scene conversations keyed by their
 * own FormID.
 */
export const listDialogConversations = async (
  db: Tx,
  modId: number,
): Promise<DialogConversationRow[]> => {
  const { rows } = await db.query(
    `SELECT
       COALESCE(ds.quest_formid_hex, ds.formid_hex) AS conversation_key,
       MIN(ds.quest_formid_hex) AS quest_formid_hex,
       MIN(ds.edid) AS sample_scene_edid,
       MIN(ds.formid_hex) AS sample_scene_formid_hex,
       COUNT(DISTINCT ds.id)::int AS scene_count,
       COUNT(dsp.id)::int AS phase_count
     FROM dialog_scenes ds
     LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     WHERE ds.mod_id = $1
     GROUP BY COALESCE(ds.quest_formid_hex, ds.formid_hex)
     ORDER BY phase_count DESC, scene_count DESC, conversation_key ASC`,
    [modId],
  );
  return rows as DialogConversationRow[];
};

export type SceneDialogLineRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  phase_order: number;
  alias_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_id: number | null;
  info_formid_hex: string | null;
  speaker_name: string | null;
  string_id: number | null;
  source: string | null;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  qa_issue_count: number;
};

/**
 * Load the full dialog content for a scene, returning phase-ordered lines
 * with speaker info and translation data.
 *
 * Joins scene phases → topics → nodes → strings → translations to produce
 * a flat sortable result that the UI can render as a conversation.
 */
export const getSceneDialog = async (
  db: Tx,
  sceneId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<SceneDialogLineRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       dsp.phase_order,
       dsp.alias_id,
       dt.formid_hex AS topic_formid_hex,
       dt.edid AS topic_edid,
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.speaker_name,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.text AS translation,
       t.status,
       COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM dialog_scene_phases dsp
     JOIN dialog_scenes ds ON ds.id = dsp.scene_id
     JOIN dialog_topics dt ON dt.id = dsp.topic_id
     LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
     LEFT JOIN strings s
       ON s.id = dn.response_string_id
      AND s.lang = $2
     LEFT JOIN translations t
       ON t.src_string_id = s.id
      AND t.target_lang = $3
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $3
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
        LIMIT 1
      )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id
         AND qi.target_lang = $3
         AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE dsp.scene_id = $1
     ORDER BY dsp.phase_order ASC, dn.id ASC`,
    [sceneId, srcLang, targetLang],
  );
  return rows as SceneDialogLineRow[];
};

/**
 * Load a stitched conversation stream by grouping all scenes that belong to
 * the same quest. Scene order falls back to dialog_scenes.id which preserves
 * import order from the plugin walk.
 */
export const getConversationDialog = async (
  db: Tx,
  modId: number,
  conversationKey: string,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<SceneDialogLineRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       dsp.phase_order,
       dsp.alias_id,
       dt.formid_hex AS topic_formid_hex,
       dt.edid AS topic_edid,
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.speaker_name,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.text AS translation,
       t.status,
       COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM dialog_scenes ds
     JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     JOIN dialog_topics dt ON dt.id = dsp.topic_id
     LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
     LEFT JOIN strings s
       ON s.id = dn.response_string_id
      AND s.lang = $3
     LEFT JOIN translations t
       ON t.src_string_id = s.id
      AND t.target_lang = $4
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $4
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
        LIMIT 1
      )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id
         AND qi.target_lang = $4
         AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE ds.mod_id = $1
       AND COALESCE(ds.quest_formid_hex, ds.formid_hex) = $2
     ORDER BY ds.id ASC, dsp.phase_order ASC, dn.id ASC`,
    [modId, conversationKey, srcLang, targetLang],
  );
  return rows as SceneDialogLineRow[];
};
