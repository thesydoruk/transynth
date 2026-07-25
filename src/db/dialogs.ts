import type { Tx } from './types';

/**
 * Upsert a dialog topic (DIAL record) for a specific mod and return its id.
 */
export const upsertDialogTopic = async (
  db: Tx,
  modId: number,
  formidHex: string,
  edid?: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_topics(mod_id, formid_hex, edid)
     VALUES ($1, $2, $3)
     ON CONFLICT(mod_id, formid_hex) DO UPDATE
       SET edid = COALESCE(EXCLUDED.edid, dialog_topics.edid)
     RETURNING id`,
    [modId, formidHex, edid ?? null],
  );
  return rows[0].id;
};

/**
 * Upsert a dialog node (INFO record) under a topic.
 *
 * Nodes hold graph structure only; their text is resolved from the `records`
 * and `strings` tables when a tree or scene is queried.
 */
export const upsertDialogNode = async (
  db: Tx,
  topicId: number,
  infoFormidHex: string,
  speakerFormidHex?: string | null,
  speakerName?: string | null,
  previousInfoFormidHex?: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_nodes(
       topic_id, info_formid_hex, speaker_formid_hex, speaker_name, previous_info_formid_hex
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(topic_id, info_formid_hex) DO UPDATE SET
       speaker_formid_hex = COALESCE(EXCLUDED.speaker_formid_hex, dialog_nodes.speaker_formid_hex),
       speaker_name = COALESCE(EXCLUDED.speaker_name, dialog_nodes.speaker_name),
       previous_info_formid_hex = COALESCE(EXCLUDED.previous_info_formid_hex, dialog_nodes.previous_info_formid_hex),
       updated_at = NOW()
     RETURNING id`,
    [
      topicId,
      infoFormidHex,
      speakerFormidHex ?? null,
      speakerName ?? null,
      previousInfoFormidHex ?? null,
    ],
  );
  return rows[0].id;
};

/**
 * Upsert a directed edge between two dialog INFO nodes.
 */
export const upsertDialogEdge = async (
  db: Tx,
  topicId: number,
  fromInfoFormidHex: string,
  toInfoFormidHex: string,
  edgeKind = 'previous',
  confidence = 'exact',
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_edges(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind, confidence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind) DO UPDATE
       SET confidence = EXCLUDED.confidence
     RETURNING id`,
    [topicId, fromInfoFormidHex, toInfoFormidHex, edgeKind, confidence],
  );
  return rows[0].id;
};

/**
 * Insert or update a dialog scene record.
 */
export const upsertDialogScene = async (
  db: Tx,
  modId: number,
  formidHex: string,
  edid: string | null,
  questFormidHex: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_scenes(mod_id, formid_hex, edid, quest_formid_hex)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(mod_id, formid_hex) DO UPDATE SET
       edid = COALESCE(EXCLUDED.edid, dialog_scenes.edid),
       quest_formid_hex = COALESCE(EXCLUDED.quest_formid_hex, dialog_scenes.quest_formid_hex)
     RETURNING id`,
    [modId, formidHex, edid, questFormidHex],
  );
  return rows[0].id;
};

/**
 * Insert a scene phase linking a scene to a dialog topic at a given order.
 */
export const upsertDialogScenePhase = async (
  db: Tx,
  sceneId: number,
  phaseOrder: number,
  aliasId: number,
  topicId: number,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO dialog_scene_phases(scene_id, phase_order, alias_id, topic_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(scene_id, phase_order, topic_id) DO UPDATE SET
       alias_id = EXCLUDED.alias_id
     RETURNING id`,
    [sceneId, phaseOrder, aliasId, topicId],
  );
  return rows[0].id;
};
