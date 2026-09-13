import type { Tx } from '../../../../db';
import { CONFIG } from '../../../../config';
import { DIALOG_PROMPT_PATH, DIALOG_RESPONSE_PATH } from './lines';
import {
  assembleDialogTree,
  type DialogTreeNode,
  type TreeBranchRow,
  type TreeQuestRow,
  type TreeSceneRow,
  type TreeTopicRow,
} from './assembleDialogTree';

export type { DialogTreeKind, DialogTreeNode } from './assembleDialogTree';
export { ORPHAN_GROUP_KEY } from './assembleDialogTree';

/**
 * Resolve the source strings of every `dn` (dialog node) row of the enclosing
 * query, together with their translation and QA state.
 */
const LINE_JOINS = `
  LEFT JOIN records r
    ON r.mod_id = $1
   AND r.signature = 'INFO'
   AND r.formid_hex = dn.info_formid_hex
   AND r.path_simplified IN ($4, $5)
  LEFT JOIN strings s
    ON s.record_id = r.id
   AND s.lang = $2
  LEFT JOIN translations t
    ON t.src_string_id = s.id
   AND t.target_lang = $3
  LEFT JOIN qa_issues qi
    ON qi.src_string_id = s.id
   AND qi.target_lang = $3
   AND qi.is_active = TRUE`;

const LINE_COUNTS = `
  COUNT(DISTINCT s.id)::int AS line_count,
  COUNT(DISTINCT s.id) FILTER (WHERE t.text IS NOT NULL AND t.text <> '')::int AS translated_count,
  COUNT(DISTINCT s.id) FILTER (WHERE qi.id IS NOT NULL)::int AS qa_count`;

const TOPICS_SQL = `
  SELECT
    dt.id::text AS key,
    COALESCE(NULLIF(dt.edid, ''), dt.formid_hex) AS label,
    dt.formid_hex,
    dt.quest_formid_hex,
    dt.branch_formid_hex,
    COUNT(DISTINCT dn.id)::int AS node_count,
    ${LINE_COUNTS}
  FROM dialog_topics dt
  JOIN dialog_nodes dn ON dn.topic_id = dt.id
  ${LINE_JOINS}
  WHERE dt.mod_id = $1
  GROUP BY dt.id, dt.edid, dt.formid_hex, dt.quest_formid_hex, dt.branch_formid_hex`;

const BRANCHES_SQL = `
  SELECT
    db.id::text AS key,
    COALESCE(NULLIF(db.edid, ''), db.formid_hex) AS label,
    db.formid_hex,
    db.quest_formid_hex,
    db.start_topic_formid_hex,
    COUNT(DISTINCT dn.id)::int AS node_count,
    ${LINE_COUNTS}
  FROM dialog_branches db
  JOIN dialog_topics dt
    ON dt.mod_id = db.mod_id
   AND (
     dt.branch_formid_hex = db.formid_hex
     OR dt.formid_hex = db.start_topic_formid_hex
   )
  JOIN dialog_nodes dn ON dn.topic_id = dt.id
  ${LINE_JOINS}
  WHERE db.mod_id = $1
  GROUP BY db.id, db.edid, db.formid_hex, db.quest_formid_hex, db.start_topic_formid_hex`;

const SCENES_SQL = `
  SELECT
    ds.id::text AS key,
    COALESCE(NULLIF(ds.edid, ''), ds.formid_hex) AS label,
    ds.formid_hex,
    ds.quest_formid_hex,
    COUNT(DISTINCT dsp.id)::int AS node_count,
    ${LINE_COUNTS},
    BOOL_OR(ds.timing_sensitive) AS timing_sensitive
  FROM dialog_scenes ds
  LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
  LEFT JOIN dialog_nodes dn ON dn.topic_id = dsp.topic_id
  ${LINE_JOINS}
  WHERE ds.mod_id = $1
  GROUP BY ds.id, ds.edid, ds.formid_hex, ds.quest_formid_hex`;

const QUESTS_SQL = `
  SELECT formid_hex, edid, name
  FROM dialog_quests
  WHERE mod_id = $1`;

/**
 * Load the quest-oriented dialog tree of a mod, with translation progress
 * rolled up from the leaves.
 *
 * The navigator renders this forest as one expandable list instead of four
 * disconnected scopes.
 */
export const listDialogTree = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<DialogTreeNode[]> => {
  const params = [modId, srcLang, targetLang, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH];
  const quests = await db.query(QUESTS_SQL, [modId]);
  const scenes = await db.query(SCENES_SQL, params);
  const branches = await db.query(BRANCHES_SQL, params);
  const topics = await db.query(TOPICS_SQL, params);

  return assembleDialogTree(
    quests.rows as TreeQuestRow[],
    (scenes.rows as TreeSceneRow[]).map((row) => ({
      ...row,
      timing_sensitive: row.timing_sensitive === true,
    })),
    branches.rows as TreeBranchRow[],
    topics.rows as TreeTopicRow[],
  );
};
