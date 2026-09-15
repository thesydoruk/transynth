/**
 * The last step of every mod import: prune rows left over from an earlier run,
 * promote imported strings to translations, let the game do its own
 * post-processing, then mark the job completed.
 *
 * Nothing here is engine-specific. Anything that is — reading a dialog graph
 * out of an ESP, indexing voice takes — is passed in as `afterConvert`.
 */
import { logImport } from '../../../logging/loggers';
import { pruneStaleModImportData } from '../../bulk';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from '../localeHelpers';
import { markDone } from '../jobStatus';
import { convertImportedStringsToTranslations } from './translationConvert';
import { commitExtrasStop, extrasStopRequested } from './extrasStop';
import type { ModImportRunContext } from './context';

export type FinalizeModImportOptions = {
  /**
   * True when the game's own localized string tables supplied the text, so
   * every locale was imported and the source locale is the canonical one.
   * False when the text came from the plugin (or catalogue) inline.
   */
  importedLocaleTables: boolean;
  /**
   * Game-specific post-processing, run after translations are promoted and
   * before the job is marked done — the dialog graph, scenes, speaker
   * resolution, and the voice index for Creation Engine titles.
   */
  afterConvert?: () => Promise<void>;
};

export const finalizeModImport = async (
  ctx: ModImportRunContext,
  options: FinalizeModImportOptions,
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

  if (ctx.job.is_localized && !ctx.importSingleLocaleMode.value && options.importedLocaleTables) {
    await convertImportedStringsToTranslations(
      ctx.db,
      importModId,
      MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
      true,
    );
  } else if (!ctx.job.is_localized || !options.importedLocaleTables) {
    await convertImportedStringsToTranslations(ctx.db, importModId, ctx.pluginStringLang, false);
  }

  if (extrasStopRequested(ctx)) {
    await commitExtrasStop(ctx);
    return;
  }

  if (options.afterConvert) {
    await options.afterConvert();
    if (extrasStopRequested(ctx)) {
      await commitExtrasStop(ctx);
      return;
    }
  }

  await markDone(ctx.db, ctx.job.id, ctx.imported.value);
  const elapsed = ((Date.now() - ctx.startTime) / 1000).toFixed(1);
  logImport.info(
    `[Mod Import #${ctx.job.id}] Completed: ${ctx.imported.value} records in ${elapsed}s`,
  );
  ctx.onProgress?.(ctx.imported.value, ctx.job.total_records);
};
