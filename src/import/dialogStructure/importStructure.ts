/**
 * Persist the dialog structure extracted from a plugin — quests, branches,
 * topics and their ownership — so the UI can show lines in conversation order.
 * Used by the worker's import finalize phase and the structure backfill script.
 */
import type { Tx } from '../../db';
import {
  replaceDialogQuestStages,
  setDialogTopicOwnership,
  upsertDialogBranch,
  upsertDialogQuest,
} from '../../db';
import type { DialogStructureExtract } from '../../formats/esp';

export type StructureImportResult = {
  quests: number;
  branches: number;
  dialLinks: number;
  deletedQuests: number;
  deletedBranches: number;
};

/**
 * Persist QUST / DLBR records and stamp DIAL ownership onto existing topics.
 *
 * Stub quests are also created for FormIDs referenced by scenes or branches but
 * missing as QUST records in this plugin (masters), so conversations can still
 * group by a stable quest key.
 */
export const importDialogStructure = async (
  db: Tx,
  modId: number,
  structure: DialogStructureExtract,
  sceneQuestFormIds: string[],
): Promise<StructureImportResult> => {
  const questFormIds = new Set<string>();

  for (const quest of structure.quests) {
    const questId = await upsertDialogQuest(
      db,
      modId,
      quest.formId,
      quest.edid || null,
      quest.name,
    );
    await replaceDialogQuestStages(db, questId, quest.stages);
    questFormIds.add(quest.formId);
  }

  for (const branch of structure.branches) {
    await upsertDialogBranch(
      db,
      modId,
      branch.formId,
      branch.edid || null,
      branch.questFormId,
      branch.startTopicFormId,
    );
    if (branch.questFormId) questFormIds.add(branch.questFormId);
  }

  let dialLinks = 0;
  for (const dial of structure.dialOwnership) {
    await setDialogTopicOwnership(db, modId, dial.formId, dial.questFormId, dial.branchFormId);
    if (dial.questFormId || dial.branchFormId) dialLinks++;
    if (dial.questFormId) questFormIds.add(dial.questFormId);
  }

  for (const questFormId of sceneQuestFormIds) {
    if (questFormId) questFormIds.add(questFormId);
  }

  for (const questFormId of questFormIds) {
    if (!structure.quests.some((quest) => quest.formId === questFormId)) {
      await upsertDialogQuest(db, modId, questFormId, null, null);
    }
  }

  // Also stamp topics that only know their branch: inherit the branch's quest.
  await db.query(
    `UPDATE dialog_topics dt
        SET quest_formid_hex = COALESCE(dt.quest_formid_hex, db.quest_formid_hex)
      FROM dialog_branches db
     WHERE dt.mod_id = $1
       AND db.mod_id = $1
       AND dt.branch_formid_hex = db.formid_hex
       AND dt.quest_formid_hex IS NULL
       AND db.quest_formid_hex IS NOT NULL`,
    [modId],
  );

  const keptQuestIds = [...questFormIds];
  const { rowCount: deletedQuests } = await db.query(
    `DELETE FROM dialog_quests
      WHERE mod_id = $1
        AND formid_hex <> ALL($2::text[])`,
    [modId, keptQuestIds],
  );

  const keptBranchIds = structure.branches.map((branch) => branch.formId);
  const { rowCount: deletedBranches } = await db.query(
    `DELETE FROM dialog_branches
      WHERE mod_id = $1
        AND formid_hex <> ALL($2::text[])`,
    [modId, keptBranchIds],
  );

  return {
    quests: questFormIds.size,
    branches: structure.branches.length,
    dialLinks,
    deletedQuests: deletedQuests ?? 0,
    deletedBranches: deletedBranches ?? 0,
  };
};
