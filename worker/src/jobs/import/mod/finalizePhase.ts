/**
 * Final mod-import phase: prune stale rows, promote translations, import dialog
 * structure/scenes, resolve speakers, then mark the job completed.
 */
import { EspReader } from '../../../../../src/formats/esp';
import { logImport } from '../../../../../src/logging/loggers';
import {
  pruneStaleModImportData,
  type DialogGraphImportContext,
} from '../../../../../src/import/bulk';
import { resolveModDialogSpeakers } from '../../../../../src/import/dialogSpeakers';
import { importDialogStructure } from '../../../../../src/import/dialogStructure/importStructure';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from '../../../../../src/import/mod/localeHelpers';
import { markDone } from '../../../../../src/import/mod/jobStatus';
import { importSceneRecords } from './sceneImport';
import { convertImportedStringsToTranslations } from './translationConvert';
import { commitExtrasStop, extrasStopRequested } from './extrasStop';
import type { ModImportPhaseContext } from './phases';

export const finalizeModImportJob = async (
  ctx: ModImportPhaseContext,
  esp: EspReader,
  dialogGraphCtx: DialogGraphImportContext,
): Promise<void> => {
  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  if (ctx.pruneStaleImportData) {
    const pruned = await pruneStaleModImportData(
      ctx.db,
      importModId,
      ctx.keptImportRecordKeys,
      ctx.keptImportStringIds,
    );
    if (pruned.deletedStrings > 0 || pruned.deletedRecords > 0) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Pruned stale rows: ${pruned.deletedStrings} string(s), ${pruned.deletedRecords} record(s)`,
      );
    }
    const graph = pruned.dialogGraph;
    if (
      graph.deletedNodes > 0 ||
      graph.deletedTopics > 0 ||
      graph.deletedScenes > 0 ||
      graph.deletedBranches > 0 ||
      graph.deletedQuests > 0
    ) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Pruned stale dialog graph: ${graph.deletedNodes} node(s), ` +
          `${graph.deletedEdges} edge(s), ${graph.deletedTopics} topic(s), ${graph.deletedScenes} scene(s), ` +
          `${graph.deletedBranches} branch(es), ${graph.deletedQuests} quest(s)`,
      );
    }
  }

  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  if (ctx.job.is_localized && !ctx.importSingleLocaleMode.value && ctx.localeSources.length > 0) {
    await convertImportedStringsToTranslations(
      ctx.db,
      importModId,
      MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
      true,
    );
  } else if (!ctx.job.is_localized || ctx.localeSources.length === 0) {
    await convertImportedStringsToTranslations(ctx.db, importModId, ctx.pluginStringLang, false);
  }

  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

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
        `[Mod Import #${ctx.job.id}] Imported ${imported.scenes} scene(s) with ${imported.phases} dialog phase(s)` +
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
      `[Mod Import #${ctx.job.id}] Scene/structure import failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      await ctx.db.query('ROLLBACK');
    } catch {
      /* ignore */
    }
  }

  // Runs last: scene aliases identify the player and conversation counterpart.
  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  try {
    await ctx.db.query('BEGIN');
    const resolved = await resolveModDialogSpeakers(
      ctx.db,
      importModId,
      dialogGraphCtx.speakerIndex,
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
      `[Mod Import #${ctx.job.id}] Speaker gender resolution failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      await ctx.db.query('ROLLBACK');
    } catch {
      /* ignore */
    }
  }

  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  await markDone(ctx.db, ctx.job.id, ctx.imported.value);
  const elapsed = ((Date.now() - ctx.startTime) / 1000).toFixed(1);
  logImport.info(
    `[Mod Import #${ctx.job.id}] Completed: ${ctx.imported.value} records in ${elapsed}s`,
  );
  ctx.onProgress?.(ctx.imported.value, ctx.job.total_records);
};
