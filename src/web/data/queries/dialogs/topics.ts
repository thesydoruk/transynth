import type { Tx } from '../../../../db';
import { CONFIG } from '../../../../config';
import {
  DIALOG_PROMPT_PATH,
  DIALOG_RESPONSE_PATH,
  dialogLinesLateralSql,
  type DialogLine,
} from './lines';

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
  lines: DialogLine[];
};

export type DialogTreeEdgeRow = {
  edge_id: number;
  from_info_formid_hex: string;
  to_info_formid_hex: string;
  edge_kind: string;
  confidence: string;
};

/**
 * List dialog topics that hold at least one INFO node.
 *
 * Topics referenced only by a scene phase (their INFOs live in a master plugin)
 * have no tree to show, so they stay out of the topic list.
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
     JOIN dialog_nodes dn ON dn.topic_id = dt.id
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
 * @param targetLang - Target language for the translation join.
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
       COALESCE(dl.lines, '[]'::json) AS lines
     FROM dialog_nodes dn
     JOIN dialog_topics dt ON dt.id = dn.topic_id
     LEFT JOIN LATERAL (${dialogLinesLateralSql({
       srcLang: '$2',
       targetLang: '$3',
       responsePath: '$4',
       promptPath: '$5',
     })}
     ) dl ON TRUE
     WHERE dn.topic_id = $1
     ORDER BY dn.id ASC`,
    [topicId, srcLang, targetLang, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
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
