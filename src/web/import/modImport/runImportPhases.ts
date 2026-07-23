import type { Tx } from '../../../db';
import { upsertMod } from '../../../db';
import { EspReader, type EspStringRow } from '../../../formats/esp';
import { CONFIG } from '../../../config';
import { logImport } from '../../../logging/loggers';
import type { GameType } from '../../../types';
import { parseVortexModFolder } from '../../../utils/vortexFolder';
import {
  trackModImportBulkResults,
  type ModImportBulkResult,
  type DialogGraphImportContext,
} from '../modImportBulk';
import {
  discoverLocaleSources,
  localeSourcesByLocale,
  estimateLocalizedImportTotal,
} from '../modImportLocaleStream';
import { deriveModNameFromFileName } from './jobs';
import { discoverArchiveCandidatesForPlugin } from './discovery';
import {
  MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
  isImportAllLocalesRequest,
  resolveSingleImportLocale,
  resolveModStringsLang,
} from './localeHelpers';
import { buildSpeakerFormIdMap, buildVoiceSpeakerMap } from './speakerMaps';
import { createModImportBatchWriter, type ModImportBatchWriter } from './importBatchWriter';
import type { ModImportJob, ProgressCb } from './types';

type ActiveImportState = { cancel: boolean; pause: boolean };

export type ModImportPhaseContext = {
  db: Tx;
  job: ModImportJob;
  state: ActiveImportState;
  espPath: string;
  game: GameType;
  importModId: number | null;
  imported: { value: number };
  progressTotal: { value: number };
  importSingleLocaleMode: { value: boolean };
  selectedLocale: { value: string | null };
  localeSources: ReturnType<typeof discoverLocaleSources>;
  pluginStringLang: string;
  pruneStaleImportData: boolean;
  keptImportRecordKeys: Set<string>;
  keptImportStringIds: Set<number>;
  onProgress?: ProgressCb;
  startTime: number;
};

const trackImportBatch = (ctx: ModImportPhaseContext, results: ModImportBulkResult[]): void => {
  if (!ctx.pruneStaleImportData) return;
  trackModImportBulkResults(results, ctx.keptImportRecordKeys, ctx.keptImportStringIds);
};

export const ensureImportModId = async (ctx: ModImportPhaseContext): Promise<number> => {
  if (ctx.importModId != null) return ctx.importModId;
  const modName =
    ctx.job.nexus_mod_name?.trim() ||
    (ctx.job.source_folder ? parseVortexModFolder(ctx.job.source_folder)?.modName : null) ||
    deriveModNameFromFileName(ctx.job.file_name);
  const importModId = await upsertMod(ctx.db, modName, ctx.espPath, ctx.job.file_hash, ctx.game, {
    nexusModId: ctx.job.nexus_mod_id ?? undefined,
    nexusName: ctx.job.nexus_mod_name ?? undefined,
  });
  if (ctx.job.nexus_mod_id) {
    logImport.info(
      `[Mod Import #${ctx.job.id}] Nexus link: mod ${ctx.job.nexus_mod_id}${ctx.job.nexus_mod_name ? ` (${ctx.job.nexus_mod_name})` : ''}`,
    );
  }
  await ctx.db.query('UPDATE mod_imports SET mod_id = $1, updated_at = NOW() WHERE id = $2', [
    importModId,
    ctx.job.id,
  ]);
  ctx.importModId = importModId;
  return importModId;
};

export const prepareEspImportContext = async (
  ctx: ModImportPhaseContext,
): Promise<{
  esp: EspReader;
  espRows: EspStringRow[];
  dialogGraphCtx: DialogGraphImportContext;
  localesToImport: string[];
  batch: ModImportBatchWriter;
  skipRows: number;
}> => {
  const esp = new EspReader(ctx.espPath, ctx.game);
  const espRows = esp.extractStrings();
  const dialogEdidByFormId = new Map<string, string>();
  for (const row of espRows) {
    if (row.signature === 'DIAL' && row.edid) {
      dialogEdidByFormId.set(row.formId, row.edid);
    }
  }
  const dialogTopicIdCache = new Map<string, number>();
  const speakerMap = buildSpeakerFormIdMap(espRows);
  const voiceSpeakerMap = buildVoiceSpeakerMap(ctx.espPath);

  const archiveCandidates = discoverArchiveCandidatesForPlugin(ctx.espPath);
  ctx.pluginStringLang = resolveModStringsLang(
    isImportAllLocalesRequest(ctx.job.src_lang)
      ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE
      : ctx.job.src_lang,
  );

  ctx.localeSources = esp.info.isLocalized
    ? discoverLocaleSources(ctx.espPath, ctx.game, archiveCandidates)
    : [];

  if (esp.info.isLocalized && ctx.localeSources.length === 0) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Localized plugin without STRINGS files; importing inline strings as "${ctx.pluginStringLang}"`,
    );
  }

  const localeCatalog = localeSourcesByLocale(ctx.localeSources);
  ctx.selectedLocale.value =
    ctx.localeSources.length > 0
      ? resolveSingleImportLocale(
          new Map([...localeCatalog.keys()].map((locale) => [locale, true])),
          ctx.job.src_lang,
        )
      : null;
  ctx.importSingleLocaleMode.value = ctx.selectedLocale.value != null;

  const localesToImport = [...localeCatalog.keys()]
    .filter((locale) => !ctx.importSingleLocaleMode.value || locale === ctx.selectedLocale.value)
    .sort();

  if (localesToImport.length > 0) {
    ctx.progressTotal.value = estimateLocalizedImportTotal(
      espRows,
      ctx.localeSources,
      localesToImport,
    );
    await ctx.db.query('UPDATE mod_imports SET total_records = $1 WHERE id = $2', [
      ctx.progressTotal.value,
      ctx.job.id,
    ]);
  }

  const dialogGraphCtx: DialogGraphImportContext = {
    dialogEdidByFormId,
    speakerMap,
    voiceSpeakerMap,
    topicIdCache: dialogTopicIdCache,
  };

  const batch = createModImportBatchWriter({
    db: ctx.db,
    jobId: ctx.job.id,
    importModId: ctx.importModId!,
    importBatchSize: CONFIG.dbChunkSize,
    progressEvery: CONFIG.modImportProgressEvery,
    progressTotal: ctx.progressTotal.value,
    dialogGraphCtx,
    trackImportBatch: (results) => trackImportBatch(ctx, results),
    onProgress: ctx.onProgress,
    getImported: () => ctx.imported.value,
    setImported: (value) => {
      ctx.imported.value = value;
    },
  });

  return {
    esp,
    espRows,
    dialogGraphCtx,
    localesToImport,
    batch,
    skipRows: ctx.job.imported_records,
  };
};
