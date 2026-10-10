/**
 * Write a Witcher 3 upload's string tables into records/strings.
 *
 * The source language's tables make the records. Every other language beside
 * it is written as that language's strings on the same records — the shape a
 * localized Bethesda plugin's STRINGS tables produce — and the shared
 * finalizer turns them into translations of the source. That is how the
 * Remastered edition's official Ukrainian (`ua`) arrives as `uk` translations,
 * and the game's other languages as reference.
 */
import { CONFIG } from '../../../config';
import { logImport } from '../../../logging/loggers';
import {
  bulkInsertModImportRows,
  trackModImportBulkResults,
  type ModImportBulkRow,
} from '../../../import/bulk';
import { commitExtrasStop, extrasStopRequested } from '../../../import/mod/run/extrasStop';
import type { ModImportRunContext } from '../../contract';
import {
  listW3StringsFiles,
  resolveW3ExtractRoot,
  resolveW3SourceLang,
  w3AppLocale,
} from '../packLayout';
import { buildW3CsvRows, collectW3LanguageTables, type W3TableEntry } from './tables';
import { persistW3VoiceClips } from '../voice/clips';
import { persistW3Speakers } from '../voice/speakers';
import { collectW3SceneSpeakers } from '../scenes';

/** Provenance stored on strings read from the game's tables. */
const W3_SOURCE_KIND = 'w3strings';

/** Write rows in batches, one transaction each; false when the job was stopped. */
const writeRows = async (
  ctx: ModImportRunContext,
  importModId: number,
  rows: ModImportBulkRow[],
  countsTowardProgress: boolean,
): Promise<boolean> => {
  for (let i = 0; i < rows.length; i += CONFIG.dbChunkSize) {
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return false;
    }
    const slice = rows.slice(i, i + CONFIG.dbChunkSize);
    try {
      await ctx.db.query('BEGIN');
      const results = await bulkInsertModImportRows(ctx.db, importModId, slice);
      if (ctx.pruneStaleImportData) {
        trackModImportBulkResults(results, ctx.keptImportRecordKeys, ctx.keptImportStringIds);
      }
      if (countsTowardProgress) ctx.imported.value += results.length;
      await ctx.db.query(
        `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
        [ctx.imported.value, ctx.job.id],
      );
      await ctx.db.query('COMMIT');
    } catch (err) {
      await ctx.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
    if (countsTowardProgress) ctx.onProgress?.(ctx.imported.value, ctx.progressTotal.value);
  }
  return true;
};

export const importW3StringTables = async (ctx: ModImportRunContext): Promise<void> => {
  const importModId = ctx.importModId;
  if (importModId == null) throw new Error('Import mod id missing');

  const root = resolveW3ExtractRoot(ctx.anchorPath, ctx.job.extract_dir);
  const sourceLang = resolveW3SourceLang(listW3StringsFiles(root), ctx.pluginStringLang);
  if (!sourceLang) {
    logImport.info(`[Mod Import #${ctx.job.id}] No .w3strings tables under ${root}`);
    return;
  }

  const tables = collectW3LanguageTables(root);
  // Scenes first: whether a string is spoken decides its record's signature.
  const scenes = collectW3SceneSpeakers(root);
  const spokenIds = new Set(scenes.lines.keys());
  const sourceTable = tables.get(sourceLang)!;
  logImport.info(
    `[Mod Import #${ctx.job.id}] Witcher 3: ${tables.size} language(s) [${[...tables.keys()].join(', ')}]; ` +
      `source "${sourceLang}" (${sourceTable.size} strings) stored as lang="${ctx.pluginStringLang}"`,
  );

  const sourceRows = buildW3CsvRows(sourceTable, spokenIds);
  ctx.progressTotal.value = sourceRows.length;
  const asBulk = (rows: ReturnType<typeof buildW3CsvRows>, locale: string): ModImportBulkRow[] =>
    rows.map((csvRow) => ({ csvRow, locale, context: null, sourceKind: W3_SOURCE_KIND }));
  if (!(await writeRows(ctx, importModId, asBulk(sourceRows, ctx.pluginStringLang), true))) return;

  for (const [lang, table] of tables) {
    if (lang === sourceLang) continue;
    const locale = w3AppLocale(lang);
    if (ctx.importSingleLocaleMode.value && locale !== ctx.selectedLocale.value) continue;
    // Only lines the source has: a string with no source has nothing to translate.
    const present = new Map<string, W3TableEntry>();
    for (const [recordPath, entry] of table)
      if (sourceTable.has(recordPath)) present.set(recordPath, entry);
    if (
      !(await writeRows(
        ctx,
        importModId,
        asBulk(buildW3CsvRows(present, spokenIds), locale),
        false,
      ))
    )
      return;
    logImport.info(
      `[Mod Import #${ctx.job.id}] Witcher 3 "${lang}" → "${locale}": ${present.size} strings`,
    );
  }

  // The source language's voice, when the upload carries it: one clip per take,
  // joined to its line by string id.
  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }
  const voice = await persistW3VoiceClips(
    ctx.db,
    importModId,
    root,
    sourceLang,
    ctx.pluginStringLang,
  );
  if (voice.clips > 0) {
    logImport.info(
      `[Mod Import #${ctx.job.id}] Witcher 3 voice "${sourceLang}": ${voice.clips} takes, ${voice.linked} linked to a line`,
    );
    // Who says each take, from the scene files beside it.
    if (scenes.scenes > 0) {
      const persisted = await persistW3Speakers(ctx.db, importModId, scenes);
      logImport.info(
        `[Mod Import #${ctx.job.id}] Witcher 3 speakers: ${scenes.scenes} scenes, ${persisted.clips}/${voice.clips} takes ` +
          `attributed, ${persisted.speakers} speakers (${persisted.withGender} with a gender)`,
      );
    }
  }
};
