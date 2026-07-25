import type { Tx } from '../../../../db';
import {
  DIALOG_PROMPT_PATH,
  DIALOG_RESPONSE_PATH,
  dialogLinesLateralSql,
  type DialogLine,
} from './lines';
import {
  DIALOG_NODE_PARTICIPANT_COLUMNS,
  dialogNodeSpeakerJoinsSql,
} from './participants';
import type { DialogTranscriptRow } from './scope';
import { flattenDialogTree, type TopicEdgeRow, type TopicNodeRow } from './tree';

type TopicHeadRow = { label: string; topic_formid_hex: string };

type TopicNodeQueryRow = TopicNodeRow & { lines: DialogLine[] };

/**
 * Load one DIAL topic as a depth-annotated transcript.
 *
 * Tree order and indentation are resolved here instead of in the browser so
 * every scope hands the UI the same flat list of entries.
 *
 * @param db - Database handle.
 * @param modId - Mod that must own the topic.
 * @param topicId - Dialog topic id.
 * @param srcLang - Source language of the resolved strings.
 * @param targetLang - Target language of the joined translations.
 */
export const getTopicTranscript = async (
  db: Tx,
  modId: number,
  topicId: number,
  srcLang: string,
  targetLang: string,
): Promise<DialogTranscriptRow | null> => {
  const { rows: headRows } = await db.query(
    `SELECT COALESCE(NULLIF(dt.edid, ''), dt.formid_hex) AS label,
            dt.formid_hex AS topic_formid_hex
     FROM dialog_topics dt
     WHERE dt.id = $1 AND dt.mod_id = $2`,
    [topicId, modId],
  );
  const head = (headRows as TopicHeadRow[])[0];
  if (!head) return null;

  const { rows: nodeRows } = await db.query(
    `SELECT
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.speaker_name,
       ${DIALOG_NODE_PARTICIPANT_COLUMNS},
       COALESCE(dl.lines, '[]'::json) AS lines
     FROM dialog_nodes dn
     JOIN dialog_topics dt ON dt.id = dn.topic_id
     ${dialogNodeSpeakerJoinsSql('dt.mod_id')}
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
    `SELECT de.from_info_formid_hex, de.to_info_formid_hex, de.edge_kind
     FROM dialog_edges de
     WHERE de.topic_id = $1
     ORDER BY de.id ASC`,
    [topicId],
  );

  return {
    scope: 'topics',
    key: String(topicId),
    label: head.label,
    entries: flattenDialogTree(
      nodeRows as TopicNodeQueryRow[],
      edgeRows as TopicEdgeRow[],
      head.topic_formid_hex,
    ),
  };
};
