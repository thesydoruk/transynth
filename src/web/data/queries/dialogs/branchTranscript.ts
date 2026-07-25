import type { Tx } from '../../../../db';
import type { DialogScope, DialogTranscriptRow } from './scope';
import { loadTopicTreeEntries } from './topicTranscript';

type BranchTopicRow = {
  topic_id: number;
  topic_formid_hex: string;
  label: string;
  is_start: boolean;
};

/**
 * Load one DLBR dialog branch: every owned topic as a sectioned INFO tree.
 *
 * The start topic (SNAM) is listed first; remaining topics follow by EDID so a
 * translator reads the branch in Creation Kit order when possible.
 */
export const getBranchTranscript = async (
  db: Tx,
  modId: number,
  branchId: number,
  srcLang: string,
  targetLang: string,
): Promise<DialogTranscriptRow | null> => {
  const { rows: headRows } = await db.query(
    `SELECT COALESCE(NULLIF(db.edid, ''), db.formid_hex) AS label,
            db.formid_hex AS branch_formid_hex,
            db.start_topic_formid_hex
     FROM dialog_branches db
     WHERE db.id = $1 AND db.mod_id = $2`,
    [branchId, modId],
  );
  const head = (
    headRows as Array<{
      label: string;
      branch_formid_hex: string;
      start_topic_formid_hex: string | null;
    }>
  )[0];
  if (!head) return null;

  const { rows: topicRows } = await db.query(
    `SELECT
       dt.id AS topic_id,
       dt.formid_hex AS topic_formid_hex,
       COALESCE(NULLIF(dt.edid, ''), dt.formid_hex) AS label,
       (dt.formid_hex = $3)::boolean AS is_start
     FROM dialog_topics dt
     WHERE dt.mod_id = $1
       AND (
         dt.branch_formid_hex = $2
         OR ($3::text IS NOT NULL AND dt.formid_hex = $3)
       )
     ORDER BY (dt.formid_hex = $3) DESC NULLS LAST, label ASC`,
    [modId, head.branch_formid_hex, head.start_topic_formid_hex],
  );

  const topics = topicRows as BranchTopicRow[];
  const entries = [];
  for (const topic of topics) {
    const tree = await loadTopicTreeEntries(
      db,
      topic.topic_id,
      topic.topic_formid_hex,
      srcLang,
      targetLang,
      topic.label,
    );
    entries.push(...tree);
  }

  return {
    scope: 'branches' as DialogScope,
    key: String(branchId),
    label: head.label,
    entries,
  };
};
