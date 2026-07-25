import type { Tx } from '../../../../db';
import { CONFIG } from '../../../../config';
import { DIALOG_PROMPT_PATH, DIALOG_RESPONSE_PATH } from './lines';
import type { DialogGroupRow, DialogScope } from './scope';

/**
 * Resolve the source strings of every `dn` (dialog node) row of the enclosing
 * query, together with their translation and QA state.
 *
 * Written as plain LEFT JOINs rather than a lateral aggregate so a single
 * GROUP BY can count nodes and lines in one pass.
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

/** Progress counters shared by every scope. */
const LINE_COUNTS = `
  COUNT(DISTINCT s.id)::int AS line_count,
  COUNT(DISTINCT s.id) FILTER (WHERE t.text IS NOT NULL AND t.text <> '')::int AS translated_count,
  COUNT(DISTINCT s.id) FILTER (WHERE qi.id IS NOT NULL)::int AS qa_count`;

const TOPICS_SQL = `
  SELECT
    dt.id::text AS key,
    COALESCE(NULLIF(dt.edid, ''), dt.formid_hex) AS label,
    NULLIF(dt.formid_hex, COALESCE(NULLIF(dt.edid, ''), dt.formid_hex)) AS sublabel,
    COUNT(DISTINCT dn.id)::int AS node_count,
    ${LINE_COUNTS}
  FROM dialog_topics dt
  JOIN dialog_nodes dn ON dn.topic_id = dt.id
  ${LINE_JOINS}
  WHERE dt.mod_id = $1
  GROUP BY dt.id, dt.edid, dt.formid_hex
  ORDER BY label ASC`;

const BRANCHES_SQL = `
  SELECT
    db.id::text AS key,
    COALESCE(NULLIF(db.edid, ''), db.formid_hex) AS label,
    COALESCE(NULLIF(dq.edid, ''), db.quest_formid_hex) AS sublabel,
    COUNT(DISTINCT dn.id)::int AS node_count,
    ${LINE_COUNTS}
  FROM dialog_branches db
  LEFT JOIN dialog_quests dq
    ON dq.mod_id = db.mod_id AND dq.formid_hex = db.quest_formid_hex
  JOIN dialog_topics dt
    ON dt.mod_id = db.mod_id
   AND (
     dt.branch_formid_hex = db.formid_hex
     OR dt.formid_hex = db.start_topic_formid_hex
   )
  JOIN dialog_nodes dn ON dn.topic_id = dt.id
  ${LINE_JOINS}
  WHERE db.mod_id = $1
  GROUP BY db.id, db.edid, db.formid_hex, dq.edid, db.quest_formid_hex
  ORDER BY label ASC`;

const SCENES_SQL = `
  SELECT
    ds.id::text AS key,
    COALESCE(NULLIF(ds.edid, ''), ds.formid_hex) AS label,
    NULLIF(ds.formid_hex, COALESCE(NULLIF(ds.edid, ''), ds.formid_hex)) AS sublabel,
    COUNT(DISTINCT dsp.id)::int AS node_count,
    ${LINE_COUNTS}
  FROM dialog_scenes ds
  LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
  LEFT JOIN dialog_nodes dn ON dn.topic_id = dsp.topic_id
  ${LINE_JOINS}
  WHERE ds.mod_id = $1
  GROUP BY ds.id, ds.edid, ds.formid_hex
  ORDER BY label ASC`;

/*
 * Scenes of one quest form a conversation. Labels prefer the QUST EDID/name
 * when the structure import created a dialog_quests row.
 */
const CONVERSATIONS_SQL = `
  SELECT
    COALESCE(ds.quest_formid_hex, ds.formid_hex) AS key,
    COALESCE(
      NULLIF(MIN(dq.edid), ''),
      NULLIF(MIN(dq.name), ''),
      NULLIF(MIN(ds.edid), ''),
      MIN(ds.formid_hex)
    ) AS label,
    MIN(ds.quest_formid_hex) AS sublabel,
    COUNT(DISTINCT dsp.id)::int AS node_count,
    ${LINE_COUNTS}
  FROM dialog_scenes ds
  LEFT JOIN dialog_quests dq
    ON dq.mod_id = ds.mod_id AND dq.formid_hex = ds.quest_formid_hex
  LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
  LEFT JOIN dialog_nodes dn ON dn.topic_id = dsp.topic_id
  ${LINE_JOINS}
  WHERE ds.mod_id = $1
  GROUP BY COALESCE(ds.quest_formid_hex, ds.formid_hex)
  ORDER BY label ASC`;

const SQL_BY_SCOPE: Record<DialogScope, string> = {
  topics: TOPICS_SQL,
  branches: BRANCHES_SQL,
  scenes: SCENES_SQL,
  conversations: CONVERSATIONS_SQL,
};

/**
 * List every selectable dialog group of a mod with its translation progress.
 *
 * The whole list is returned in one call: the navigator sorts, filters, and
 * searches it client-side, which keeps typing instant even on large mods.
 */
export const listDialogGroups = async (
  db: Tx,
  modId: number,
  scope: DialogScope,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<DialogGroupRow[]> => {
  const { rows } = await db.query(SQL_BY_SCOPE[scope], [
    modId,
    srcLang,
    targetLang,
    DIALOG_RESPONSE_PATH,
    DIALOG_PROMPT_PATH,
  ]);
  return rows as DialogGroupRow[];
};
