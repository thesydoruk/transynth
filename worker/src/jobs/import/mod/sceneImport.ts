/**
 * Persist SCEN records so dialog lines can be traced back to the scene and
 * phase they belong to — and so timer/package/start-scene actions mark scenes
 * whose timing is independent of `.fuz` length.
 */
import type { Tx } from '../../../../../src/db';
import {
  insertDialogSceneAction,
  upsertDialogScene,
  upsertDialogScenePhase,
  upsertDialogTopic,
} from '../../../../../src/db';
import {
  sceneHasTimingConstraint,
  type SceneAction,
  type SceneRecord,
} from '../../../../../src/formats/esp';
import type { DialogGraphImportContext } from '../../../../../src/import/bulk';

export type SceneImportResult = {
  scenes: number;
  phases: number;
  actions: number;
  timingSensitive: number;
  deletedScenes: number;
};

export type ImportSceneRecordsOptions = {
  /**
   * Drop scenes the plugin no longer contains. Import wants this; a backfill
   * must not, or a failed/empty extract would wipe the dialog graph.
   */
  pruneMissingScenes?: boolean;
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

const persistAction = async (
  db: Tx,
  modId: number,
  sceneId: number,
  action: SceneAction,
  ctx: DialogGraphImportContext,
): Promise<void> => {
  const primaryTopic = action.topicFormId ?? action.topicFormIds[0] ?? null;
  const topicId =
    primaryTopic != null ? await resolveSceneTopicId(db, modId, primaryTopic, ctx) : null;
  await insertDialogSceneAction(db, sceneId, {
    actionType: action.actionType,
    aliasId: action.aliasId,
    topicId,
    startPhase: action.startPhase,
    endPhase: action.endPhase,
    timerMinSeconds: action.timerMinSeconds,
    timerMaxSeconds: action.timerMaxSeconds,
    loopMin: action.loopMin,
    loopMax: action.loopMax,
    flags: action.flags,
    startSceneFormidHex: action.startSceneFormId,
  });
};

/**
 * Store SCEN records as scenes with phase-ordered dialog topic references.
 *
 * The plugin is the source of truth: phases and actions are replaced per scene
 * and scenes the plugin no longer contains are dropped.
 */
export const importSceneRecords = async (
  db: Tx,
  modId: number,
  scenes: SceneRecord[],
  ctx: DialogGraphImportContext,
  options: ImportSceneRecordsOptions = {},
): Promise<SceneImportResult> => {
  let phases = 0;
  let actions = 0;
  let timingSensitive = 0;

  for (const scene of scenes) {
    const sensitive = sceneHasTimingConstraint(scene.actions);
    if (sensitive) timingSensitive++;
    const sceneId = await upsertDialogScene(
      db,
      modId,
      scene.formId,
      scene.edid || null,
      scene.questFormId,
      sensitive,
    );

    await db.query('DELETE FROM dialog_scene_actions WHERE scene_id = $1', [sceneId]);
    await db.query('DELETE FROM dialog_scene_phases WHERE scene_id = $1', [sceneId]);

    for (const action of scene.actions) {
      await persistAction(db, modId, sceneId, action, ctx);
      actions++;
      for (const topicFormId of action.topicFormIds) {
        const topicId = await resolveSceneTopicId(db, modId, topicFormId, ctx);
        await upsertDialogScenePhase(db, sceneId, action.startPhase, action.aliasId, topicId);
        phases++;
      }
    }
  }

  let deletedScenes = 0;
  const prune = options.pruneMissingScenes !== false && scenes.length > 0;
  if (prune) {
    const { rowCount } = await db.query(
      'DELETE FROM dialog_scenes WHERE mod_id = $1 AND formid_hex <> ALL($2::text[])',
      [modId, scenes.map((scene) => scene.formId)],
    );
    deletedScenes = rowCount ?? 0;
  }

  return {
    scenes: scenes.length,
    phases,
    actions,
    timingSensitive,
    deletedScenes,
  };
};
