import type { Tx } from '../../../../db';
import {
  DIALOG_PROMPT_PATH,
  DIALOG_RESPONSE_PATH,
  dialogLinesLateralSql,
  type DialogLine,
} from './lines';
import type { DialogEntryRow, DialogScope, DialogTranscriptRow } from './scope';

type PhaseRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  phase_order: number;
  alias_id: number;
  topic_formid_hex: string;
  node_id: number | null;
  info_formid_hex: string | null;
  speaker_name: string | null;
  variant_index: number;
  variant_count: number;
  lines: DialogLine[];
};

/**
 * Phase-ordered lines of one or more scenes.
 *
 * A phase points at a dialog topic, and a topic can hold several conditioned
 * INFOs. Those alternatives are returned as numbered variants; the ones without
 * text are dropped unless the whole phase has none, so a phase never collapses
 * into an empty row and never explodes into unused branches.
 */
const phaseLinesSql = (opts: {
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
    scene_id, scene_formid_hex, scene_edid, phase_order, alias_id,
    topic_formid_hex, node_id, info_formid_hex, speaker_name, lines,
    (ROW_NUMBER() OVER (PARTITION BY phase_id ORDER BY node_id ASC NULLS FIRST))::int AS variant_index,
    (COUNT(*) OVER (PARTITION BY phase_id))::int AS variant_count
  FROM phase_variants
  WHERE json_array_length(lines) > 0 OR with_text_count = 0
  ORDER BY ${opts.order}`;

/** Turn phase rows into transcript entries, heading each new scene when asked. */
const toEntries = (rows: PhaseRow[], withSections: boolean): DialogEntryRow[] => {
  let previousSceneId: number | null = null;
  return rows.map((row) => {
    const startsScene = row.scene_id !== previousSceneId;
    previousSceneId = row.scene_id;
    return {
      id: `phase-${row.scene_id}-${row.phase_order}-${row.node_id ?? row.variant_index}`,
      depth: 0,
      section: withSections && startsScene ? (row.scene_edid ?? row.scene_formid_hex) : null,
      speaker: row.speaker_name,
      alias_id: row.alias_id,
      info_formid_hex: row.info_formid_hex,
      topic_formid_hex: row.topic_formid_hex,
      variant_index: row.variant_index,
      variant_count: row.variant_count,
      lines: row.lines,
    };
  });
};

/** Load one SCEN scene as an ordered transcript. */
export const getSceneTranscript = async (
  db: Tx,
  modId: number,
  sceneId: number,
  srcLang: string,
  targetLang: string,
): Promise<DialogTranscriptRow | null> => {
  const { rows: headRows } = await db.query(
    `SELECT COALESCE(NULLIF(ds.edid, ''), ds.formid_hex) AS label
     FROM dialog_scenes ds
     WHERE ds.id = $1 AND ds.mod_id = $2`,
    [sceneId, modId],
  );
  const head = (headRows as Array<{ label: string }>)[0];
  if (!head) return null;

  const { rows } = await db.query(
    phaseLinesSql({
      where: 'dsp.scene_id = $1',
      order: 'phase_order ASC, node_id ASC NULLS FIRST',
      srcLang: '$2',
      targetLang: '$3',
      responsePath: '$4',
      promptPath: '$5',
    }),
    [sceneId, srcLang, targetLang, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
  );

  return {
    scope: 'scenes' as DialogScope,
    key: String(sceneId),
    label: head.label,
    entries: toEntries(rows as PhaseRow[], false),
  };
};

/**
 * Load every scene of one quest stitched into a single transcript.
 *
 * Scene order falls back to `dialog_scenes.id`, which preserves the order the
 * plugin walk imported them in.
 */
export const getConversationTranscript = async (
  db: Tx,
  modId: number,
  conversationKey: string,
  srcLang: string,
  targetLang: string,
): Promise<DialogTranscriptRow | null> => {
  const { rows: headRows } = await db.query(
    `SELECT COALESCE(NULLIF(MIN(ds.edid), ''), MIN(ds.formid_hex)) AS label
     FROM dialog_scenes ds
     WHERE ds.mod_id = $1 AND COALESCE(ds.quest_formid_hex, ds.formid_hex) = $2`,
    [modId, conversationKey],
  );
  const head = (headRows as Array<{ label: string | null }>)[0];
  if (!head?.label) return null;

  const { rows } = await db.query(
    phaseLinesSql({
      where: 'ds.mod_id = $1 AND COALESCE(ds.quest_formid_hex, ds.formid_hex) = $2',
      order: 'scene_id ASC, phase_order ASC, node_id ASC NULLS FIRST',
      srcLang: '$3',
      targetLang: '$4',
      responsePath: '$5',
      promptPath: '$6',
    }),
    [modId, conversationKey, srcLang, targetLang, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
  );

  return {
    scope: 'conversations' as DialogScope,
    key: conversationKey,
    label: head.label,
    entries: toEntries(rows as PhaseRow[], true),
  };
};
