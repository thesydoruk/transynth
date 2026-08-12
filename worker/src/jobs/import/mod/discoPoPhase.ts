/**
 * Import Disco Translator Final Cut `.po` language packs into records/strings.
 */
import { CONFIG } from '../../../../../src/config';
import { logImport } from '../../../../../src/logging/loggers';
import {
  bulkInsertModImportRows,
  bulkUpsertImportTranslations,
  trackModImportBulkResults,
  type ModImportBulkResult,
  type ModImportBulkRow,
} from '../../../../../src/import/bulk';
import {
  buildDiscoPoCsvRows,
  collectDiscoPoLocales,
  resolveDiscoExtractRoot,
  resolveDiscoPoSourceLocale,
} from '../../../../../src/import/mod/discoPoLocales';
import { commitExtrasStop, extrasStopRequested } from './extrasStop';
import type { ModImportBatchWriter } from './batchWriter';
import type { ModImportPhaseContext } from './phases';

const trackImportBatch = (ctx: ModImportPhaseContext, results: ModImportBulkResult[]): void => {
  if (!ctx.pruneStaleImportData) return;
  trackModImportBulkResults(results, ctx.keptImportRecordKeys, ctx.keptImportStringIds);
};

/** Composite key without the `PO\\` prefix, used for translation overlays. */
const overlayKeyFromPath = (recordPath: string): string => recordPath.replace(/^PO\\/, '');

export const importDiscoPoStringRows = async (
  ctx: ModImportPhaseContext,
  _batch: ModImportBatchWriter,
): Promise<void> => {
  if (ctx.game !== 'disco') return;

  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  const extractRoot =
    ctx.job.extract_dir && ctx.job.extract_dir.length > 0
      ? ctx.job.extract_dir
      : resolveDiscoExtractRoot(ctx.espPath);

  const locales = collectDiscoPoLocales(extractRoot);
  const sourceLocale = resolveDiscoPoSourceLocale(locales);
  if (!sourceLocale) {
    logImport.debug(`[Mod Import #${ctx.job.id}] No Disco Final Cut .po files found`);
    return;
  }

  const sourceBundle = locales.get(sourceLocale)!;
  logImport.info(
    `[Mod Import #${ctx.job.id}] Disco PO: ${locales.size} locale folder(s); using "${sourceLocale}" stored as lang="${ctx.pluginStringLang}"`,
  );

  const rows = buildDiscoPoCsvRows(sourceBundle.entries, sourceBundle.wavStems);
  const sourceStringIdByKey = new Map<string, number>();
  const importBatchSize = CONFIG.dbChunkSize;
  const bulkRows: ModImportBulkRow[] = rows.map((r) => ({
    csvRow: r,
    locale: ctx.pluginStringLang,
    context: null,
    sourceKind: 'po',
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
      sourceStringIdByKey.set(overlayKeyFromPath(res.row.csvRow.Path), res.stringId);
    }
    ctx.imported.value += results.length;
    await ctx.db.query(
      `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
      [ctx.imported.value, ctx.job.id],
    );
    await ctx.db.query('COMMIT');
    ctx.onProgress?.(ctx.imported.value, ctx.imported.value);
  }

  for (const [locale, bundle] of locales) {
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return;
    }
    if (locale === sourceLocale) continue;
    if (ctx.importSingleLocaleMode.value && locale !== ctx.selectedLocale.value) continue;

    const items: { srcStringId: number; text: string }[] = [];
    for (const [key, text] of bundle.entries) {
      const sourceStringId = sourceStringIdByKey.get(key);
      if (!sourceStringId) continue;
      items.push({ srcStringId: sourceStringId, text });
    }
    const localeCount = await bulkUpsertImportTranslations(ctx.db, items, locale, 'po');
    if (localeCount > 0) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Disco PO locale "${locale}": ${localeCount} translations`,
      );
    }
  }

  logImport.info(
    `[Mod Import #${ctx.job.id}] Disco PO source locale "${sourceLocale}": ${rows.length} strings`,
  );
};
