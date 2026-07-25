import type { Tx } from '../../../../db';
import { CONFIG } from '../../../../config';
import {
  DIALOG_PROMPT_PATH,
  DIALOG_RESPONSE_PATH,
  dialogLinesLateralSql,
  type DialogLine,
} from './lines';

export type DialogSceneRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  quest_formid_hex: string | null;
  phase_count: number;
};

export type DialogConversationRow = {
  conversation_key: string;
  quest_formid_hex: string | null;
  sample_scene_edid: string | null;
  sample_scene_formid_hex: string;
  scene_count: number;
  phase_count: number;
};

export type SceneDialogLineRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  phase_order: number;
  alias_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_id: number | null;
  info_formid_hex: string | null;
  speaker_name: string | null;
  /** Position of this INFO among the alternatives of its phase (1-based). */
  variant_index: number;
  /** How many alternative INFOs the phase offers. */
  variant_count: number;
  lines: DialogLine[];
};

/**
 * List all dialog scenes for a mod, ordered by phase count descending.
 */
export const listDialogScenes = async (db: Tx, modId: number): Promise<DialogSceneRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       ds.quest_formid_hex,
       COUNT(dsp.id)::int AS phase_count
     FROM dialog_scenes ds
     LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     WHERE ds.mod_id = $1
     GROUP BY ds.id, ds.formid_hex, ds.edid, ds.quest_formid_hex
     ORDER BY phase_count DESC, ds.formid_hex ASC`,
    [modId],
  );
  return rows as DialogSceneRow[];
};

/**
 * List aggregated conversation groups.
 *
 * A conversation groups all scenes that belong to the same quest. Scenes
 * without a quest owner become single-scene conversations keyed by their
 * own FormID.
 */
export const listDialogConversations = async (
  db: Tx,
  modId: number,
): Promise<DialogConversationRow[]> => {
  const { rows } = await db.query(
    `SELECT
       COALESCE(ds.quest_formid_hex, ds.formid_hex) AS conversation_key,
       MIN(ds.quest_formid_hex) AS quest_formid_hex,
       MIN(ds.edid) AS sample_scene_edid,
       MIN(ds.formid_hex) AS sample_scene_formid_hex,
       COUNT(DISTINCT ds.id)::int AS scene_count,
       COUNT(dsp.id)::int AS phase_count
     FROM dialog_scenes ds
     LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     WHERE ds.mod_id = $1
     GROUP BY COALESCE(ds.quest_formid_hex, ds.formid_hex)
     ORDER BY phase_count DESC, scene_count DESC, conversation_key ASC`,
    [modId],
  );
  return rows as DialogConversationRow[];
};

/**
 * Build the phase-ordered line query shared by the scene and conversation views.
 *
 * A phase points at a dialog topic, and a topic can hold several conditioned
 * INFOs. Those alternatives are returned as numbered variants; the ones without
 * text are dropped unless the whole phase has none, so a phase never collapses
 * into an empty row and never explodes into unused branches.
 */
const sceneDialogLinesSql = (opts: {
  where: string;
  order: string;
  srcLang: string;
  targetLang: string;
  responsePath: string;
  promptPath: string;
}): string => `
    WITH phase_lines AS (
      SELECT
        dsp.id AS phase_id,
        ds.id AS scene_id,
        ds.formid_hex AS scene_formid_hex,
        ds.edid AS scene_edid,
        dsp.phase_order,
        dsp.alias_id,
        dt.formid_hex AS topic_formid_hex,
        dt.edid AS topic_edid,
        dn.id AS node_id,
        dn.info_formid_hex,
        dn.speaker_name,
        COALESCE(dl.lines, '[]'::json) AS lines
      FROM dialog_scene_phases dsp
      JOIN dialog_scenes ds ON ds.id = dsp.scene_id
      JOIN dialog_topics dt ON dt.id = dsp.topic_id
      LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
      LEFT JOIN LATERAL (${dialogLinesLateralSql(opts)}
      ) dl ON TRUE
      WHERE ${opts.where}
    ),
    phase_variants AS (
      SELECT
        pl.*,
        COUNT(*) FILTER (WHERE json_array_length(pl.lines) > 0)
          OVER (PARTITION BY pl.phase_id) AS with_text_count
      FROM phase_lines pl
    )
    SELECT
      scene_id,
      scene_formid_hex,
      scene_edid,
      phase_order,
      alias_id,
      topic_formid_hex,
      topic_edid,
      node_id,
      info_formid_hex,
      speaker_name,
      lines,
      (ROW_NUMBER() OVER (PARTITION BY phase_id ORDER BY node_id ASC NULLS FIRST))::int AS variant_index,
      (COUNT(*) OVER (PARTITION BY phase_id))::int AS variant_count
    FROM phase_variants
    WHERE json_array_length(lines) > 0 OR with_text_count = 0
    ORDER BY ${opts.order}`;

/**
 * Load the full dialog content for a scene as phase-ordered lines.
 */
export const getSceneDialog = async (
  db: Tx,
  sceneId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<SceneDialogLineRow[]> => {
  const { rows } = await db.query(
    sceneDialogLinesSql({
      where: 'dsp.scene_id = $1',
      order: 'phase_order ASC, node_id ASC NULLS FIRST',
      srcLang: '$2',
      targetLang: '$3',
      responsePath: '$4',
      promptPath: '$5',
    }),
    [sceneId, srcLang, targetLang, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
  );
  return rows as SceneDialogLineRow[];
};

/**
 * Load a stitched conversation stream by grouping all scenes that belong to
 * the same quest. Scene order falls back to dialog_scenes.id which preserves
 * import order from the plugin walk.
 */
export const getConversationDialog = async (
  db: Tx,
  modId: number,
  conversationKey: string,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<SceneDialogLineRow[]> => {
  const { rows } = await db.query(
    sceneDialogLinesSql({
      where: 'ds.mod_id = $1 AND COALESCE(ds.quest_formid_hex, ds.formid_hex) = $2',
      order: 'scene_id ASC, phase_order ASC, node_id ASC NULLS FIRST',
      srcLang: '$3',
      targetLang: '$4',
      responsePath: '$5',
      promptPath: '$6',
    }),
    [modId, conversationKey, srcLang, targetLang, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
  );
  return rows as SceneDialogLineRow[];
};
