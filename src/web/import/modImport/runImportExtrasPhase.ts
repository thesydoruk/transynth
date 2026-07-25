import { EspReader } from '../../../formats/esp';
import { resolveModDirectoryFromPath, resolveMcmLocaleKey } from '../../../formats/mcm';
import { CONFIG } from '../../../config';
import { logImport } from '../../../logging/loggers';
import { ensureChampollionInstalled } from '../../../tools/installTools';
import {
  bulkInsertModImportRows,
  bulkUpsertImportTranslations,
  pruneStaleModImportData,
  trackModImportBulkResults,
  type DialogGraphImportContext,
  type ModImportBulkResult,
  type ModImportBulkRow,
} from '../modImportBulk';
import { resolveModDialogSpeakers } from '../dialogSpeakers';
import { importSceneRecords } from './sceneImport';
import { importDialogStructure } from './structureImport';
import { decompilePexScriptMap, type DecompiledPexScript } from '../../export/pexDecompileService';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from './localeHelpers';
import { collectMcmLocalesForModParallel, buildMcmCsvRows } from './mcmLocales';
import { collectPexStrings, buildPexCsvRows } from './pexStrings';
import { convertImportedStringsToTranslations } from './translationConvert';
import { markDone } from './importJobStatus';
import type { ModImportBatchWriter } from './importBatchWriter';
import type { ModImportPhaseContext } from './runImportPhases';

const trackImportBatch = (ctx: ModImportPhaseContext, results: ModImportBulkResult[]): void => {
  if (!ctx.pruneStaleImportData) return;
  trackModImportBulkResults(results, ctx.keptImportRecordKeys, ctx.keptImportStringIds);
};

export const importMcmStringRows = async (
  ctx: ModImportPhaseContext,
  batch: ModImportBatchWriter,
): Promise<void> => {
  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  const mcmModDir = resolveModDirectoryFromPath(ctx.espPath);
  const mcmLocales = await collectMcmLocalesForModParallel(mcmModDir, ctx.espPath, ctx.game);
  const resolvedMcmSource =
    resolveMcmLocaleKey(mcmLocales, MOD_IMPORT_DEFAULT_SOURCE_LOCALE) ??
    resolveMcmLocaleKey(mcmLocales, ctx.pluginStringLang);

  if (!resolvedMcmSource) {
    if (mcmLocales.size > 0) {
      logImport.warn(`[Mod Import #${ctx.job.id}] MCM files found but no usable source locale`);
    } else {
      logImport.debug(`[Mod Import #${ctx.job.id}] No MCM translation files found`);
    }
    return;
  }

  const { resolvedKey: mcmSourceLocale, value: sourceMcmMap } = resolvedMcmSource;
  logImport.info(
    `[Mod Import #${ctx.job.id}] MCM: ${mcmLocales.size} locale file(s); using "${mcmSourceLocale}" text stored as lang="${ctx.pluginStringLang}"`,
  );

  const mcmRows = buildMcmCsvRows(sourceMcmMap);
  const sourceStringIdByKey = new Map<string, number>();
  const importBatchSize = CONFIG.dbChunkSize;
  const mcmBulkRows: ModImportBulkRow[] = mcmRows.map((r) => ({
    csvRow: r,
    locale: ctx.pluginStringLang,
    context: null,
    sourceKind: 'mcm',
  }));

  for (let i = 0; i < mcmBulkRows.length; i += importBatchSize) {
    await ctx.db.query('BEGIN');
    const slice = mcmBulkRows.slice(i, i + importBatchSize);
    const results = await bulkInsertModImportRows(ctx.db, importModId, slice);
    trackImportBatch(ctx, results);
    for (const res of results) {
      sourceStringIdByKey.set(res.row.csvRow.Path.replace(/^MCM\\/, ''), res.stringId);
    }
    ctx.imported.value += results.length;
    await ctx.db.query(
      `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
      [ctx.imported.value, ctx.job.id],
    );
    await ctx.db.query('COMMIT');
    ctx.onProgress?.(ctx.imported.value, ctx.imported.value);
  }

  for (const [locale, mcmMap] of mcmLocales) {
    if (locale === mcmSourceLocale) continue;
    if (ctx.importSingleLocaleMode.value && locale !== ctx.selectedLocale.value) continue;
    const items: { srcStringId: number; text: string }[] = [];
    for (const [key, text] of mcmMap) {
      const sourceStringId = sourceStringIdByKey.get(key);
      if (!sourceStringId) continue;
      items.push({ srcStringId: sourceStringId, text });
    }
    const localeCount = await bulkUpsertImportTranslations(ctx.db, items, locale, 'mcm');
    if (localeCount > 0) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] MCM locale "${locale}": ${localeCount} translations`,
      );
    }
  }

  logImport.info(
    `[Mod Import #${ctx.job.id}] MCM source locale "${mcmSourceLocale}": ${mcmRows.length} strings`,
  );
};

export const importPexStringRows = async (
  ctx: ModImportPhaseContext,
  batch: ModImportBatchWriter,
): Promise<void> => {
  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  const pexMap = await collectPexStrings(ctx.espPath, ctx.game);
  if (pexMap.size === 0) {
    logImport.debug(`[Mod Import #${ctx.job.id}] No PEX scripts with translatable strings found`);
    return;
  }

  let decompiled = new Map<string, DecompiledPexScript>();
  try {
    await ensureChampollionInstalled();
    const scriptBuffers = new Map<string, Buffer>();
    for (const [scriptKey, bundle] of pexMap) {
      scriptBuffers.set(scriptKey, bundle.data);
    }
    decompiled = await decompilePexScriptMap(scriptBuffers, importModId);
    logImport.info(
      `[Mod Import #${ctx.job.id}] PEX decompile: ${decompiled.size}/${scriptBuffers.size} script(s)`,
    );
  } catch (err) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Champollion unavailable — PEX filter without PSC (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const literalBefore = [...pexMap.values()].reduce((sum, b) => sum + b.literals.length, 0);
  const pexRows = buildPexCsvRows(pexMap, decompiled);
  logImport.info(
    `[Mod Import #${ctx.job.id}] PEX scripts: ${pexMap.size} script(s), ${pexRows.length} translatable string(s)` +
      (literalBefore - pexRows.length > 0 ? ` (${literalBefore - pexRows.length} filtered)` : ''),
  );
  if (pexRows.length === 0) return;

  for (const { csvRow: r, context } of pexRows) {
    await batch.pushImportRow({
      csvRow: r,
      locale: ctx.pluginStringLang,
      context,
      sourceKind: 'pex',
    });
  }
  await batch.flushPendingImportBatch();
};

export const finalizeModImportJob = async (
  ctx: ModImportPhaseContext,
  esp: EspReader,
  dialogGraphCtx: DialogGraphImportContext,
): Promise<void> => {
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

  // Runs last: scene aliases are what identify the player and the counterpart
  // of a conversation, so speaker gender can only be settled once scenes exist.
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

  await markDone(ctx.db, ctx.job.id, ctx.imported.value);
  const elapsed = ((Date.now() - ctx.startTime) / 1000).toFixed(1);
  logImport.info(
    `[Mod Import #${ctx.job.id}] Completed: ${ctx.imported.value} records in ${elapsed}s`,
  );
  ctx.onProgress?.(ctx.imported.value, ctx.job.total_records);
};
