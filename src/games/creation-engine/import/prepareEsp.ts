/**
 * Everything the ESP phase needs, read once before the first row is written:
 * the plugin, its dialogue graph, the STRINGS tables that go with it, and the
 * batch writer the phases append through.
 */
import { CONFIG } from '../../../config';
import { EspReader, type EspStringRow } from '../../../formats/esp';
import { logImport } from '../../../logging/loggers';
import { trackModImportBulkResults, type DialogGraphImportContext } from '../../../import/bulk';
import { buildPluginSpeakerIndex } from '../../../import/dialogSpeakers';
import {
  buildSpeakerActorIndex,
  loadPluginPathByBasename,
} from '../../../import/dialogSpeakers/masterPlugins';
import { discoverArchiveCandidatesForPlugin } from '../../../import/mod/discovery';
import {
  estimateLocalizedImportTotal,
  resolveEnglishLocaleMaps,
} from '../../../import/mod/localeRows';
import {
  discoverLocaleSources,
  localeSourcesByLocale,
  type LocaleStringsSource,
} from '../../../import/mod/localeSources';
import { resolveSingleImportLocale } from '../../../import/mod/localeHelpers';
import {
  buildSpeakerFormIdMap,
  buildVoiceFolderMap,
  voiceSpeakerNamesFromFolders,
} from '../../../import/mod/speakerMaps';
import {
  createModImportBatchWriter,
  type ModImportBatchWriter,
} from '../../../import/mod/run/batchWriter';
import type { ModImportRunContext } from '../../contract';
import type { CreationEngineTitle } from '../title';

export { importCreationEngineDialogGraph } from './dialogGraph';

export type EspImportPrep = {
  esp: EspReader;
  espRows: EspStringRow[];
  dialogGraphCtx: DialogGraphImportContext;
  /** STRINGS/DLSTRINGS/ILSTRINGS tables found beside the plugin, if any. */
  localeSources: LocaleStringsSource[];
  /** Locales to actually import, honouring a single-locale request. */
  localesToImport: string[];
  batch: ModImportBatchWriter;
  skipRows: number;
};

/**
 * Seed the topic id cache with topics already stored for the mod.
 *
 * A resumed import skips the INFO rows it ingested earlier, so without this the
 * cache would stay empty and scene phases could not be linked to their topics.
 */
const loadDialogTopicIdCache = async (
  ctx: ModImportRunContext,
  modId: number,
): Promise<Map<string, number>> => {
  const { rows } = await ctx.db.query<{ id: number; formid_hex: string }>(
    'SELECT id, formid_hex FROM dialog_topics WHERE mod_id = $1',
    [modId],
  );
  return new Map(rows.map((row) => [row.formid_hex, row.id]));
};

export const prepareEspImportContext = async (
  title: CreationEngineTitle,
  ctx: ModImportRunContext,
): Promise<EspImportPrep> => {
  const esp = new EspReader(ctx.anchorPath, title.subrecords);
  const espRows = esp.extractStrings();

  const dialogEdidByFormId = new Map<string, string>();
  for (const row of espRows) {
    if (row.signature === 'DIAL' && row.edid) dialogEdidByFormId.set(row.formId, row.edid);
  }

  const dialogTopicIdCache = await loadDialogTopicIdCache(ctx, ctx.importModId!);
  const speakerMap = buildSpeakerFormIdMap(espRows);
  const voiceFolderMap = buildVoiceFolderMap(ctx.anchorPath);
  const voiceSpeakerMap = voiceSpeakerNamesFromFolders(voiceFolderMap);
  const archiveCandidates = discoverArchiveCandidatesForPlugin(ctx.anchorPath);

  const localeSources = esp.info.isLocalized
    ? discoverLocaleSources(ctx.anchorPath, title, archiveCandidates)
    : [];

  if (esp.info.isLocalized && localeSources.length === 0) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Localized plugin without STRINGS files; importing inline strings as "${ctx.pluginStringLang}"`,
    );
  }

  const localeCatalog = localeSourcesByLocale(localeSources);
  ctx.selectedLocale.value =
    localeSources.length > 0
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
      localeSources,
      localesToImport,
      title.recorddefs,
    );
    await ctx.db.query('UPDATE mod_imports SET total_records = $1 WHERE id = $2', [
      ctx.progressTotal.value,
      ctx.job.id,
    ]);
  }

  const storedByBasename = await loadPluginPathByBasename(ctx.db);

  const dialogGraphCtx: DialogGraphImportContext = {
    dialogEdidByFormId,
    speakerMap,
    voiceSpeakerMap,
    voiceFolderMap,
    speakerIndex: buildPluginSpeakerIndex({
      actorIndex: buildSpeakerActorIndex(esp, title, storedByBasename),
      englishStrings: resolveEnglishLocaleMaps(localeSources)?.get('STRINGS') ?? null,
      npcReferenceNames: title.npcReference(),
      voiceFolders: voiceFolderMap,
    }),
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
    trackImportBatch: (results) => {
      if (!ctx.pruneStaleImportData) return;
      trackModImportBulkResults(results, ctx.keptImportRecordKeys, ctx.keptImportStringIds);
    },
    onProgress: ctx.onProgress,
    getImported: () => ctx.imported.value,
    setImported: (value) => {
      ctx.imported.value = value;
    },
    shouldStop: () => ctx.state.cancel || ctx.state.pause,
  });

  return {
    esp,
    espRows,
    dialogGraphCtx,
    localeSources,
    localesToImport,
    batch,
    skipRows: ctx.job.imported_records,
  };
};
