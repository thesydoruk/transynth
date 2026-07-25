import type { Tx } from '../../../db';
import { upsertDialogScene, upsertDialogScenePhase, upsertDialogTopic } from '../../../db';
import type { SceneRecord } from '../../../formats/esp';
import type { DialogGraphImportContext } from '../modImportBulk';

export type SceneImportResult = {
  scenes: number;
  phases: number;
  deletedScenes: number;
};

/**
 * Resolve the dialog topic id a scene action points at.
 *
 * The cache is filled while INFO rows are imported, but a scene may reference a
 * topic whose INFOs live in a master plugin, and a resumed import skips rows it
 * already ingested. Both cases fall back to an upsert so the phase can still be
 * linked instead of being silently dropped.
 */
const resolveSceneTopicId = async (
  db: Tx,
  modId: number,
  topicFormId: string,
  ctx: DialogGraphImportContext,
): Promise<number> => {
  const cached = ctx.topicIdCache.get(topicFormId);
  if (cached != null) return cached;

  const topicId = await upsertDialogTopic(
    db,
    modId,
    topicFormId,
    ctx.dialogEdidByFormId.get(topicFormId) ?? null,
  );
  ctx.topicIdCache.set(topicFormId, topicId);
  return topicId;
};

/**
 * Store SCEN records as scenes with phase-ordered dialog topic references.
 *
 * The plugin is the source of truth: phases are replaced per scene and scenes
 * the plugin no longer contains are dropped, so nothing stale survives a
 * re-import.
 */
export const importSceneRecords = async (
  db: Tx,
  modId: number,
  scenes: SceneRecord[],
  ctx: DialogGraphImportContext,
): Promise<SceneImportResult> => {
  let phases = 0;

  for (const scene of scenes) {
    const sceneId = await upsertDialogScene(
      db,
      modId,
      scene.formId,
      scene.edid || null,
      scene.questFormId,
    );

    await db.query('DELETE FROM dialog_scene_phases WHERE scene_id = $1', [sceneId]);

    for (const action of scene.actions) {
      const topicId = await resolveSceneTopicId(db, modId, action.topicFormId, ctx);
      await upsertDialogScenePhase(db, sceneId, action.startPhase, action.aliasId, topicId);
      phases++;
    }
  }

  const { rowCount: deletedScenes } = await db.query(
    'DELETE FROM dialog_scenes WHERE mod_id = $1 AND formid_hex <> ALL($2::text[])',
    [modId, scenes.map((scene) => scene.formId)],
  );

  return { scenes: scenes.length, phases, deletedScenes: deletedScenes ?? 0 };
};
