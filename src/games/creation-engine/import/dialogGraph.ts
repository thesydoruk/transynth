/**
 * Post-ingest dialog work for a Creation Engine plugin: quests, branches,
 * scenes, and who speaks each line.
 *
 * Runs after the strings are stored, because scene aliases are what identify
 * the player and the conversation counterpart. Every step is non-fatal — a mod
 * whose scene records will not parse still imports its text.
 */
import type { EspReader } from '../../../formats/esp';
import { logImport } from '../../../logging/loggers';
import type { DialogGraphImportContext } from '../../../import/bulk';
import { resolveModDialogSpeakers } from '../../../import/dialogSpeakers';
import { importDialogStructure } from '../../../import/dialogStructure';
import type { ModImportRunContext } from '../../contract';
import { importSceneRecords } from './sceneImport';

const rollbackQuietly = async (ctx: ModImportRunContext): Promise<void> => {
  try {
    await ctx.db.query('ROLLBACK');
  } catch {
    /* the transaction is already gone */
  }
};

const importStructureAndScenes = async (
  ctx: ModImportRunContext,
  importModId: number,
  esp: EspReader,
  dialogGraphCtx: DialogGraphImportContext,
): Promise<void> => {
  try {
    const sceneRecords = esp.extractScenes();
    const structure = esp.extractDialogStructure();
    const sceneQuestFormIds = sceneRecords
      .map((scene) => scene.questFormId)
      .filter((id): id is string => id != null);

    await ctx.db.query('BEGIN');
    const importedStructure = await importDialogStructure(
      ctx.db,
      importModId,
      structure,
      sceneQuestFormIds,
    );
    if (sceneRecords.length > 0) {
      const imported = await importSceneRecords(ctx.db, importModId, sceneRecords, dialogGraphCtx);
      logImport.info(
        `[Mod Import #${ctx.job.id}] Imported ${imported.scenes} scene(s) with ${imported.phases} dialog phase(s), ` +
          `${imported.actions} action(s), ${imported.timingSensitive} timing-sensitive` +
          (imported.deletedScenes > 0 ? `; removed ${imported.deletedScenes} stale scene(s)` : ''),
      );
    }
    await ctx.db.query('COMMIT');

    if (
      importedStructure.quests > 0 ||
      importedStructure.branches > 0 ||
      importedStructure.dialLinks > 0
    ) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Dialog structure: ${importedStructure.quests} quest(s), ` +
          `${importedStructure.branches} branch(es), ${importedStructure.dialLinks} dial link(s)` +
          (importedStructure.deletedQuests > 0 || importedStructure.deletedBranches > 0
            ? `; removed ${importedStructure.deletedQuests} quest(s), ${importedStructure.deletedBranches} branch(es)`
            : ''),
      );
    }
  } catch (err) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Scene/structure import failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await rollbackQuietly(ctx);
  }
};

const resolveSpeakers = async (
  ctx: ModImportRunContext,
  importModId: number,
  dialogGraphCtx: DialogGraphImportContext,
): Promise<void> => {
  try {
    await ctx.db.query('BEGIN');
    const resolved = await resolveModDialogSpeakers(
      ctx.db,
      importModId,
      dialogGraphCtx.speakerIndex,
      ctx.pluginStringLang,
    );
    await ctx.db.query('COMMIT');
    if (resolved.speakers > 0) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Resolved ${resolved.speakers} dialog speaker(s), ` +
          `${resolved.withGender} with a known gender`,
      );
    }
  } catch (err) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Speaker gender resolution failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await rollbackQuietly(ctx);
  }
};

export const importCreationEngineDialogGraph = async (
  ctx: ModImportRunContext,
  esp: EspReader,
  dialogGraphCtx: DialogGraphImportContext,
): Promise<void> => {
  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  await importStructureAndScenes(ctx, importModId, esp, dialogGraphCtx);
  if (ctx.state.cancel || ctx.state.pause) return;
  await resolveSpeakers(ctx, importModId, dialogGraphCtx);
};
