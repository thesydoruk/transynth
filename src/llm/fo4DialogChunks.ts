import type { Tx } from '../db';
import { DIALOG_PROMPT_PATH } from '../web/data/queries/dialogs/lines';
import type { DialogSceneContext, DialogSceneTurn } from './dialogScene';
import { windowDialogSceneTurns } from './dialogScene';

export type Fo4DialogGroupRow = {
  string_id: number;
  scene_id: number | null;
  scene_edid: string | null;
  topic_id: number | null;
  quest_edid: string | null;
  timing_sensitive: boolean | null;
  phase_order: number | null;
  prompt_first: number;
  speaker_name: string | null;
};

export type DialogChunkable = {
  stringId: number;
  sourceText: string;
  field: string | null;
  llmItem: { source: string };
};

export const loadFo4DialogLineGroups = async (
  db: Tx,
  stringIds: number[],
): Promise<Map<number, Fo4DialogGroupRow>> => {
  if (stringIds.length === 0) return new Map();
  const { rows } = await db.query<Fo4DialogGroupRow>(
    `
    SELECT DISTINCT ON (s.id)
      s.id AS string_id,
      ds.id AS scene_id,
      ds.edid AS scene_edid,
      dt.id AS topic_id,
      dq.edid AS quest_edid,
      ds.timing_sensitive,
      dsp.phase_order,
      CASE WHEN r.path_simplified = $2 THEN 0 ELSE 1 END AS prompt_first,
      nsp.display_name AS speaker_name
    FROM strings s
    JOIN records r ON r.id = s.record_id
    LEFT JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
    LEFT JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = r.mod_id
    LEFT JOIN dialog_quests dq ON dq.mod_id = dt.mod_id AND dq.formid_hex = dt.quest_formid_hex
    LEFT JOIN dialog_scene_phases dsp ON dsp.topic_id = dt.id
    LEFT JOIN dialog_scenes ds ON ds.id = dsp.scene_id AND ds.mod_id = r.mod_id
    LEFT JOIN dialog_speakers nsp ON nsp.mod_id = dt.mod_id AND nsp.speaker_key = dn.speaker_key
    WHERE s.id = ANY($1::int[])
    ORDER BY s.id, ds.id NULLS LAST, dsp.phase_order NULLS LAST
    `,
    [stringIds, DIALOG_PROMPT_PATH],
  );
  return new Map(rows.map((row) => [row.string_id, row]));
};

export const dialogGroupKey = (row: Fo4DialogGroupRow | undefined, stringId: number): string => {
  if (row?.scene_id != null) return `scene:${row.scene_id}`;
  if (row?.topic_id != null) return `topic:${row.topic_id}`;
  return `orphan:${stringId}`;
};

export const sortDialogItems = <T extends { stringId: number }>(
  items: T[],
  groups: Map<number, Fo4DialogGroupRow>,
): T[] =>
  [...items].sort((a, b) => {
    const left = groups.get(a.stringId);
    const right = groups.get(b.stringId);
    const phase = (left?.phase_order ?? 1e9) - (right?.phase_order ?? 1e9);
    if (phase !== 0) return phase;
    const prompt = (left?.prompt_first ?? 1) - (right?.prompt_first ?? 1);
    if (prompt !== 0) return prompt;
    return a.stringId - b.stringId;
  });

export const buildDialogSceneForItems = <T extends DialogChunkable>(
  items: T[],
  groups: Map<number, Fo4DialogGroupRow>,
): DialogSceneContext => {
  const meta = items.map((item) => groups.get(item.stringId)).find(Boolean);
  const turns: DialogSceneTurn[] = sortDialogItems(items, groups).map((item) => {
    const group = groups.get(item.stringId);
    return {
      id: item.stringId,
      kind: item.field === 'RNAM' ? 'prompt' : 'response',
      speaker: group?.speaker_name ?? null,
      source: item.llmItem.source,
      translate: true,
    };
  });
  return {
    questEdid: meta?.quest_edid ?? null,
    sceneEdid: meta?.scene_edid ?? null,
    timingSensitive: meta?.timing_sensitive === true,
    turns,
  };
};

const sceneForTargets = (
  scene: DialogSceneContext,
  targetIds: Set<number>,
): DialogSceneContext => ({
  ...scene,
  turns: scene.turns.map((turn) => ({
    ...turn,
    translate: turn.id != null && targetIds.has(turn.id),
  })),
});

/**
 * Group dialog lines by scene/topic, window long scenes, and isolate oversized
 * rows. Each chunk keeps the window transcript so neighbors stay visible.
 */
export const chunkFo4DialogFamily = <T extends DialogChunkable>(
  items: T[],
  groups: Map<number, Fo4DialogGroupRow>,
  opts: { maxTargets: number; singleRowMaxSourceChars: number },
): Array<{ items: T[]; scene: DialogSceneContext }> => {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = dialogGroupKey(groups.get(item.stringId), item.stringId);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }

  const chunks: Array<{ items: T[]; scene: DialogSceneContext }> = [];
  for (const groupItems of byKey.values()) {
    const ordered = sortDialogItems(groupItems, groups);
    const fullScene = buildDialogSceneForItems(ordered, groups);
    const windows = windowDialogSceneTurns(fullScene.turns, { maxTargets: opts.maxTargets });
    for (const turns of windows) {
      const windowScene: DialogSceneContext = { ...fullScene, turns };
      const windowIds = new Set(
        turns.filter((turn) => turn.translate && turn.id != null).map((turn) => turn.id!),
      );
      const windowItems = ordered.filter((item) => windowIds.has(item.stringId));
      const longItems = windowItems.filter(
        (item) => item.sourceText.length > opts.singleRowMaxSourceChars,
      );
      const normalItems = windowItems.filter(
        (item) => item.sourceText.length <= opts.singleRowMaxSourceChars,
      );
      for (const item of longItems) {
        chunks.push({
          items: [item],
          scene: sceneForTargets(windowScene, new Set([item.stringId])),
        });
      }
      if (normalItems.length > 0) {
        chunks.push({
          items: normalItems,
          scene: sceneForTargets(windowScene, new Set(normalItems.map((item) => item.stringId))),
        });
      }
    }
  }
  return chunks;
};
