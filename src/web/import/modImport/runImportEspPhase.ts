import { EspReader } from '../../../formats/esp';
import { loadNpcReferenceMap } from '../../../formats/subrecords';
import { logImport } from '../../../logging/loggers';
import {
  localeSourcesByLocale,
  loadLocaleStringsByType,
  generateImportCsvRows,
} from '../modImportLocaleStream';
import { resolveEnglishLocaleMaps } from './csvHelpers';
import { buildNpcNameMap } from './speakerMaps';
import { markFailed, markPaused } from './importJobStatus';
import type { ModImportBatchWriter } from './importBatchWriter';
import type { ModImportPhaseContext } from './runImportPhases';

export const importEspStringRows = async (
  ctx: ModImportPhaseContext,
  prep: {
    esp: EspReader;
    espRows: ReturnType<EspReader['extractStrings']>;
    dialogGraphCtx: {
      speakerMap: Map<string, string>;
    };
    localesToImport: string[];
    batch: ModImportBatchWriter;
    skipRows: number;
  },
): Promise<boolean> => {
  const { esp, espRows, dialogGraphCtx, localesToImport, batch } = prep;
  let skipRows = prep.skipRows;
  const localeCatalog = localeSourcesByLocale(ctx.localeSources);
  const speakerMap = dialogGraphCtx.speakerMap;
  const npcRefMap = loadNpcReferenceMap(ctx.game);
  const npcNameFromMod = buildNpcNameMap(
    espRows,
    resolveEnglishLocaleMaps(ctx.localeSources)?.get('STRINGS') ?? null,
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

    outer: for (const locale of localesToImport) {
      const stringsMaps = loadLocaleStringsByType(localeCatalog.get(locale)!);
      for (const r of generateImportCsvRows(espRows, stringsMaps, ctx.game)) {
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
    ctx.localeSources.length === 0
  ) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Localized plugin "${ctx.job.file_name}" has ${espRows.length} string refs but none resolved to text. ` +
        'Ensure STRINGS files exist under Strings\\ or in a companion BA2 (vanilla FO4 base game: "Fallout4 - Interface.ba2").',
    );
  }

  for (const r of generateImportCsvRows(espRows, null, ctx.game)) {
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
