/**
 * Main import phase: plugin (ESP/ESM/ESL) strings.
 *
 * For localized plugins the rows are emitted once per requested locale, keyed
 * against the English STRINGS tables so every locale lands on the same records.
 * Returns false when the loop stopped early on cancel/pause, which tells the
 * caller to skip the remaining phases.
 */
import { logImport } from '../../../logging/loggers';
import { localeSourcesByLocale } from '../../../import/mod/localeSources';
import {
  loadLocaleStringsByType,
  generateImportCsvRows,
  resolveEnglishLocaleMaps,
} from '../../../import/mod/localeRows';
import { buildNpcNameMap } from '../../../import/mod/speakerMaps';
import { markFailed, markPaused } from '../../../import/mod/jobStatus';
import type { ModImportRunContext } from '../../contract';
import type { CreationEngineTitle } from '../title';
import type { EspImportPrep } from './prepareEsp';

export const importEspStringRows = async (
  title: CreationEngineTitle,
  ctx: ModImportRunContext,
  prep: EspImportPrep,
): Promise<boolean> => {
  const { esp, espRows, dialogGraphCtx, localeSources, localesToImport, batch } = prep;
  let skipRows = prep.skipRows;
  const localeCatalog = localeSourcesByLocale(localeSources);
  const speakerMap = dialogGraphCtx.speakerMap;
  const npcRefMap = title.npcReference();
  const npcNameFromMod = buildNpcNameMap(
    espRows,
    resolveEnglishLocaleMaps(localeSources)?.get('STRINGS') ?? null,
  );

  if (localesToImport.length > 0) {
    if (ctx.importSingleLocaleMode.value) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Single-locale mode: importing only "${ctx.selectedLocale.value}"`,
      );
    } else {
      logImport.info(
        `[Mod Import #${ctx.job.id}] All-localizations mode: importing ${localesToImport.length} locale(s): ${localesToImport.join(', ')}`,
      );
    }

    for (const locale of localesToImport) {
      const stringsMaps = loadLocaleStringsByType(localeCatalog.get(locale)!);
      for (const r of generateImportCsvRows(espRows, stringsMaps, title.recorddefs)) {
        if (skipRows > 0) {
          skipRows--;
          continue;
        }
        if (ctx.state.cancel) {
          await batch.discardOpenImportBatch();
          await markFailed(ctx.db, ctx.job.id, ctx.imported.value);
          logImport.info(
            `Mod Import #${ctx.job.id} cancelled at ${ctx.imported.value}/${ctx.progressTotal.value}`,
          );
          return false;
        }
        if (ctx.state.pause) {
          await batch.discardOpenImportBatch();
          await markPaused(ctx.db, ctx.job.id, ctx.imported.value);
          logImport.info(
            `Mod Import #${ctx.job.id} paused at ${ctx.imported.value}/${ctx.progressTotal.value}`,
          );
          return false;
        }
        const speakerFid = r.SpeakerFormID ?? speakerMap.get(r.FormID ?? '');
        const contextLoc = speakerFid
          ? (npcNameFromMod.get(speakerFid) ?? npcRefMap.get(speakerFid) ?? null)
          : null;
        await batch.pushImportRow({
          csvRow: r,
          locale,
          context: contextLoc,
          sourceKind: 'mod-import',
        });
      }
    }
    await batch.flushPendingImportBatch();
    return true;
  }

  if (
    esp.info.isLocalized &&
    espRows.some((row) => row.isLstringId) &&
    localeSources.length === 0
  ) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Localized plugin "${ctx.job.file_name}" has ${espRows.length} string refs but none resolved to text. ` +
        'Ensure STRINGS files exist under Strings\\ or in a companion BA2 (vanilla FO4 base game: "Fallout4 - Interface.ba2").',
    );
  }

  for (const r of generateImportCsvRows(espRows, null, title.recorddefs)) {
    if (skipRows > 0) {
      skipRows--;
      continue;
    }
    if (ctx.state.cancel) {
      await batch.discardOpenImportBatch();
      await markFailed(ctx.db, ctx.job.id, ctx.imported.value);
      logImport.info(
        `Mod Import #${ctx.job.id} cancelled at ${ctx.imported.value}/${ctx.progressTotal.value}`,
      );
      return false;
    }
    if (ctx.state.pause) {
      await batch.discardOpenImportBatch();
      await markPaused(ctx.db, ctx.job.id, ctx.imported.value);
      logImport.info(
        `Mod Import #${ctx.job.id} paused at ${ctx.imported.value}/${ctx.progressTotal.value}`,
      );
      return false;
    }
    const speakerFid = r.SpeakerFormID ?? speakerMap.get(r.FormID ?? '');
    const context = speakerFid
      ? (npcNameFromMod.get(speakerFid) ?? npcRefMap.get(speakerFid) ?? null)
      : null;
    await batch.pushImportRow({
      csvRow: r,
      locale: ctx.pluginStringLang,
      context,
      sourceKind: 'mod-import',
    });
  }
  await batch.flushPendingImportBatch();
  return true;
};
