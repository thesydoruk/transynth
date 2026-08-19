import type { Tx } from '../../../../db';
import { loadModInfoVoiceResponseNumbers } from '../../../../voice/infoResponseNumbers';
import {
  DIALOG_PROMPT_PATH,
  DIALOG_RESPONSE_PATH,
  dialogLinesLateralSql,
  remapDialogLineVoiceVariants,
  type DialogLine,
} from './lines';
import {
  DIALOG_NODE_PARTICIPANT_COLUMNS,
  dialogNodeSpeakerJoinsSql,
} from './participants';
import type { DialogEntryRow, DialogTranscriptRow } from './scope';
import { flattenDialogTree, type TopicEdgeRow, type TopicNodeRow } from './tree';

type TopicNodeQueryRow = TopicNodeRow & { lines: DialogLine[] };

/**
 * Load the INFO tree of one topic as flat transcript entries.
 *
 * @param section - Optional heading stamped on the first entry (branch/conversation views).
 */
export const loadTopicTreeEntries = async (
  db: Tx,
  topicId: number,
  topicFormidHex: string,
  srcLang: string,
  targetLang: string,
  section: string | null = null,
): Promise<DialogEntryRow[]> => {
  const { rows: topicMeta } = await db.query<{ mod_id: number }>(
    `SELECT mod_id FROM dialog_topics WHERE id = $1`,
    [topicId],
  );
  const responseMap =
    topicMeta[0] != null
      ? await loadModInfoVoiceResponseNumbers(db, topicMeta[0].mod_id)
      : null;

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

  const nodes = (nodeRows as TopicNodeQueryRow[]).map((node) => ({
    ...node,
    lines: remapDialogLineVoiceVariants(node.info_formid_hex, node.lines ?? [], responseMap),
  }));
  const entries = flattenDialogTree(nodes, edgeRows as TopicEdgeRow[], topicFormidHex);
  if (section && entries.length > 0) {
    entries[0] = { ...entries[0], section };
  } else if (section) {
    // Keep an empty marker so a topic without strings still shows up.
    return [
      {
        id: `topic-section-${topicId}`,
        depth: 0,
        section,
        speaker: null,
        speaker_key: null,
        speaker_gender: 'unknown',
        addressee_kind: 'unknown',
        addressee: null,
        addressee_gender: 'unknown',
        alias_id: null,
        info_formid_hex: null,
        topic_formid_hex: topicFormidHex,
        variant_index: 1,
        variant_count: 1,
        lines: [],
      },
    ];
  }
  return entries;
};

/**
 * Load one DIAL topic as a depth-annotated transcript.
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
  const head = (headRows as Array<{ label: string; topic_formid_hex: string }>)[0];
  if (!head) return null;

  return {
    scope: 'topics',
    key: String(topicId),
    label: head.label,
    timing_sensitive: false,
    entries: await loadTopicTreeEntries(
      db,
      topicId,
      head.topic_formid_hex,
      srcLang,
      targetLang,
    ),
  };
};
