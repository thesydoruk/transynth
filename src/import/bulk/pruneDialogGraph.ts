import type { Tx } from '../../db';
import type { PruneDialogGraphResult } from './types';

/**
 * Delete dialog graph rows that no longer describe anything in the mod.
 *
 * Must run after stale `records`/`strings` have been removed: nodes are kept
 * alive by the INFO record they point at, so the record table is the source of
 * truth for what still exists in the plugin.
 */
export const pruneOrphanDialogGraph = async (
  db: Tx,
  modId: number,
): Promise<PruneDialogGraphResult> => {
  const { rowCount: deletedNodes } = await db.query(
    `DELETE FROM dialog_nodes dn
      USING dialog_topics dt
      WHERE dn.topic_id = dt.id
        AND dt.mod_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM records r
           WHERE r.mod_id = dt.mod_id
             AND r.signature = 'INFO'
             AND r.formid_hex = dn.info_formid_hex
        )`,
    [modId],
  );

  /*
   * An edge is only drawable when both of its INFO endpoints still exist as
   * nodes of the same topic; a dangling parent would otherwise hide the child
   * node from the tree, because it never qualifies as a root.
   */
  const { rowCount: deletedEdges } = await db.query(
    `DELETE FROM dialog_edges de
      USING dialog_topics dt
      WHERE de.topic_id = dt.id
        AND dt.mod_id = $1
        AND (
          NOT EXISTS (
            SELECT 1 FROM dialog_nodes dn
             WHERE dn.topic_id = de.topic_id
               AND dn.info_formid_hex = de.from_info_formid_hex
          )
          OR NOT EXISTS (
            SELECT 1 FROM dialog_nodes dn
             WHERE dn.topic_id = de.topic_id
               AND dn.info_formid_hex = de.to_info_formid_hex
          )
        )`,
    [modId],
  );

  const { rowCount: deletedTopics } = await db.query(
    `DELETE FROM dialog_topics dt
      WHERE dt.mod_id = $1
        AND NOT EXISTS (SELECT 1 FROM dialog_nodes dn WHERE dn.topic_id = dt.id)
        AND NOT EXISTS (SELECT 1 FROM dialog_scene_phases dsp WHERE dsp.topic_id = dt.id)`,
    [modId],
  );

  const { rowCount: deletedScenes } = await db.query(
    `DELETE FROM dialog_scenes ds
      WHERE ds.mod_id = $1
        AND NOT EXISTS (SELECT 1 FROM dialog_scene_phases dsp WHERE dsp.scene_id = ds.id)`,
    [modId],
  );

  const { rowCount: deletedBranches } = await db.query(
    `DELETE FROM dialog_branches db
      WHERE db.mod_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM dialog_topics dt
           WHERE dt.mod_id = db.mod_id AND dt.branch_formid_hex = db.formid_hex
        )
        AND NOT EXISTS (
          SELECT 1 FROM dialog_topics dt
           WHERE dt.mod_id = db.mod_id AND dt.formid_hex = db.start_topic_formid_hex
        )`,
    [modId],
  );

  const { rowCount: deletedQuests } = await db.query(
    `DELETE FROM dialog_quests dq
      WHERE dq.mod_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM dialog_scenes ds
           WHERE ds.mod_id = dq.mod_id AND ds.quest_formid_hex = dq.formid_hex
        )
        AND NOT EXISTS (
          SELECT 1 FROM dialog_branches db
           WHERE db.mod_id = dq.mod_id AND db.quest_formid_hex = dq.formid_hex
        )
        AND NOT EXISTS (
          SELECT 1 FROM dialog_topics dt
           WHERE dt.mod_id = dq.mod_id AND dt.quest_formid_hex = dq.formid_hex
        )`,
    [modId],
  );

  return {
    deletedNodes: deletedNodes ?? 0,
    deletedEdges: deletedEdges ?? 0,
    deletedTopics: deletedTopics ?? 0,
    deletedScenes: deletedScenes ?? 0,
    deletedBranches: deletedBranches ?? 0,
    deletedQuests: deletedQuests ?? 0,
  };
};
