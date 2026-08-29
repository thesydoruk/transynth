import type { Tx } from './types';

/**
 * Insert or update a QUST skeleton row used to label conversations.
 */
export const upsertDialogQuest = async (
  db: Tx,
  modId: number,
  formidHex: string,
  edid: string | null,
  name: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_quests(mod_id, formid_hex, edid, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(mod_id, formid_hex) DO UPDATE SET
       edid = COALESCE(EXCLUDED.edid, dialog_quests.edid),
       name = COALESCE(EXCLUDED.name, dialog_quests.name)
     RETURNING id`,
    [modId, formidHex, edid, name],
  );
  return rows[0].id;
};

/** Replace the stage index list of one quest. */
export const replaceDialogQuestStages = async (
  db: Tx,
  questId: number,
  stages: number[],
): Promise<void> => {
  await db.query('DELETE FROM dialog_quest_stages WHERE quest_id = $1', [questId]);
  for (const stageIndex of stages) {
    await db.query(
      `INSERT INTO dialog_quest_stages(quest_id, stage_index)
       VALUES ($1, $2)
       ON CONFLICT(quest_id, stage_index) DO NOTHING`,
      [questId, stageIndex],
    );
  }
};

/**
 * Insert or update a DLBR dialog branch.
 */
export const upsertDialogBranch = async (
  db: Tx,
  modId: number,
  formidHex: string,
  edid: string | null,
  questFormidHex: string | null,
  startTopicFormidHex: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_branches(
       mod_id, formid_hex, edid, quest_formid_hex, start_topic_formid_hex
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(mod_id, formid_hex) DO UPDATE SET
       edid = COALESCE(EXCLUDED.edid, dialog_branches.edid),
       quest_formid_hex = COALESCE(EXCLUDED.quest_formid_hex, dialog_branches.quest_formid_hex),
       start_topic_formid_hex = COALESCE(
         EXCLUDED.start_topic_formid_hex, dialog_branches.start_topic_formid_hex
       )
     RETURNING id`,
    [modId, formidHex, edid, questFormidHex, startTopicFormidHex],
  );
  return rows[0].id;
};

/** Attach quest / branch ownership to an existing dialog topic. */
export const setDialogTopicOwnership = async (
  db: Tx,
  modId: number,
  topicFormidHex: string,
  questFormidHex: string | null,
  branchFormidHex: string | null,
): Promise<void> => {
  await db.query(
    `UPDATE dialog_topics SET
       quest_formid_hex = COALESCE($3, quest_formid_hex),
       branch_formid_hex = COALESCE($4, branch_formid_hex)
     WHERE mod_id = $1 AND formid_hex = $2`,
    [modId, topicFormidHex, questFormidHex, branchFormidHex],
  );
};
