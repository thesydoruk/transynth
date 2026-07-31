/**
 * Import phases for strings that live outside the plugin: MCM config
 * translations and Papyrus (PEX) script strings.
 *
 * Job finalization (prune, structure, speakers, markDone) lives in
 * `finalizePhase.ts`.
 */
import { resolveModDirectoryFromPath, resolveMcmLocaleKey } from '../../../../../src/formats/mcm';
import { CONFIG } from '../../../../../src/config';
import { logImport } from '../../../../../src/logging/loggers';
import { ensureChampollionInstalled } from '../../../../../src/tools/installTools';
import {
  bulkInsertModImportRows,
  bulkUpsertImportTranslations,
  trackModImportBulkResults,
  type ModImportBulkResult,
  type ModImportBulkRow,
} from '../../../../../src/import/bulk';
import {
  decompilePexScriptMap,
  type DecompiledPexScript,
} from '../../../../../src/web/export/pexDecompileService';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from '../../../../../src/import/mod/localeHelpers';
import {
  collectMcmLocalesForModParallel,
  buildMcmCsvRows,
} from '../../../../../src/import/mod/mcmLocales';
import {
  buildInterfaceTranslateCsvRows,
  collectInterfaceTranslateLocales,
} from '../../../../../src/import/mod/interfaceTranslate';
import { collectPexStrings, buildPexCsvRows } from '../../../../../src/import/mod/pexStrings';
import { commitExtrasStop, extrasStopRequested } from './extrasStop';
import type { ModImportBatchWriter } from './batchWriter';
import type { ModImportPhaseContext } from './phases';

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
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return;
    }
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
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return;
    }
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

export const importInterfaceTranslateRows = async (
  ctx: ModImportPhaseContext,
  batch: ModImportBatchWriter,
): Promise<void> => {
  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  const modDir = resolveModDirectoryFromPath(ctx.espPath);
  const locales = collectInterfaceTranslateLocales(modDir, ctx.espPath, ctx.game);
  const sourceLocale = locales.has(MOD_IMPORT_DEFAULT_SOURCE_LOCALE)
    ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE
    : locales.has(ctx.pluginStringLang)
      ? ctx.pluginStringLang
      : [...locales.keys()][0];

  if (!sourceLocale) {
    logImport.debug(`[Mod Import #${ctx.job.id}] No Interface/Translate_*.txt files found`);
    return;
  }

  const sourceMap = locales.get(sourceLocale);
  if (!sourceMap || sourceMap.size === 0) return;

  logImport.info(
    `[Mod Import #${ctx.job.id}] Interface translate: ${locales.size} locale file(s); using "${sourceLocale}" as source`,
  );

  const rows = buildInterfaceTranslateCsvRows(sourceLocale, sourceMap);
  const sourceStringIdByKey = new Map<string, number>();
  const importBatchSize = CONFIG.dbChunkSize;
  const bulkRows: ModImportBulkRow[] = rows.map((r) => ({
    csvRow: r,
    locale: ctx.pluginStringLang,
    context: null,
    sourceKind: 'interface',
  }));

  for (let i = 0; i < bulkRows.length; i += importBatchSize) {
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return;
    }
    await ctx.db.query('BEGIN');
    const slice = bulkRows.slice(i, i + importBatchSize);
    const results = await bulkInsertModImportRows(ctx.db, importModId, slice);
    trackImportBatch(ctx, results);
    for (const res of results) {
      const key = res.row.csvRow.Path.split('\\').pop() ?? '';
      sourceStringIdByKey.set(key, res.stringId);
    }
    ctx.imported.value += results.length;
    await ctx.db.query(
      `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
      [ctx.imported.value, ctx.job.id],
    );
    await ctx.db.query('COMMIT');
    ctx.onProgress?.(ctx.imported.value, ctx.imported.value);
  }

  for (const [locale, translateMap] of locales) {
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return;
    }
    if (locale === sourceLocale) continue;
    if (ctx.importSingleLocaleMode.value && locale !== ctx.selectedLocale.value) continue;

    const items: { srcStringId: number; text: string }[] = [];
    for (const [key, text] of translateMap) {
      const sourceStringId = sourceStringIdByKey.get(key);
      if (!sourceStringId) continue;
      items.push({ srcStringId: sourceStringId, text });
    }
    const localeCount = await bulkUpsertImportTranslations(ctx.db, items, locale, 'interface');
    if (localeCount > 0) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Interface translate locale "${locale}": ${localeCount} translations`,
      );
    }
  }

  logImport.info(
    `[Mod Import #${ctx.job.id}] Interface translate source "${sourceLocale}": ${rows.length} strings`,
  );
};

export const importPexStringRows = async (
  ctx: ModImportPhaseContext,
  batch: ModImportBatchWriter,
): Promise<void> => {
  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  const pexMap = await collectPexStrings(ctx.espPath, ctx.game);
  if (pexMap.size === 0) {
    logImport.debug(`[Mod Import #${ctx.job.id}] No PEX scripts with translatable strings found`);
    return;
  }

  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
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

  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  const literalBefore = [...pexMap.values()].reduce((sum, b) => sum + b.literals.length, 0);
  const pexRows = buildPexCsvRows(pexMap, decompiled);
  logImport.info(
    `[Mod Import #${ctx.job.id}] PEX scripts: ${pexMap.size} script(s), ${pexRows.length} translatable string(s)` +
      (literalBefore - pexRows.length > 0 ? ` (${literalBefore - pexRows.length} filtered)` : ''),
  );
  if (pexRows.length === 0) return;

  for (const { csvRow: r, context } of pexRows) {
    if (extrasStopRequested(ctx)) {
      await batch.discardOpenImportBatch();
      await commitExtrasStop(ctx);
      return;
    }
    await batch.pushImportRow({
      csvRow: r,
      locale: ctx.pluginStringLang,
      context,
      sourceKind: 'pex',
    });
  }
  await batch.flushPendingImportBatch();
};
