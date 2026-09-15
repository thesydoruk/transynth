/**
 * Creation Engine ingestion.
 *
 * A Bethesda upload is either a plugin (ESP/ESM/ESL) with optional companion
 * BA2/BSA archives, or a plugin-less package that still ships translatable
 * text — MCM Helper files, Interface `translate_*.txt`, compiled Papyrus.
 * Both shapes go through the same phases; the plugin-less one just skips the
 * ESP phase.
 */
import path from 'node:path';
import { EspReader } from '../../../formats/esp';
import { findFirstMcmTranslationFile, hasMcmTranslationFiles } from '../../../formats/mcm';
import { logImport } from '../../../logging/loggers';
import {
  discoverArchiveCandidatesForPlugin,
  discoverModFiles,
} from '../../../import/mod/discovery';
import { filterPrimaryPlugins } from '../../../import/mod/importAnchor';
import { discoverLocaleSources } from '../../../import/mod/localeSources';
import { estimateLocalizedImportTotal } from '../../../import/mod/localeRows';
import { countMcmTranslationRecords } from '../../../import/mod/mcmLocales';
import { resolveModDirectoryFromPath } from '../../../formats/mcm';
import { finalizeModImport } from '../../../import/mod/run/finalize';
import { persistBethesdaVoiceClips } from '../../../voice/persistBethesdaVoiceClips';
import type { AnchorDescription, GameImportAdapter, ModImportRunContext } from '../../contract';
import { clearBa2Cache } from '../../../formats/ba2';
import { refreshCreationEngineDialogSpeakers } from './refreshDialogSpeakers';
import type { CreationEngineTitle } from '../title';
import { importEspStringRows } from './espPhase';
import {
  importInterfaceTranslateRows,
  importMcmStringRows,
  importPexStringRows,
} from './extrasPhase';
import { prepareExtrasOnlyImportContext } from './extrasOnlyPrep';
import { importCreationEngineDialogGraph, prepareEspImportContext } from './prepareEsp';

/** Plugin file extensions the Creation Kit produces. */
const PLUGIN_EXTENSIONS = ['.esp', '.esm', '.esl'] as const;

const isPluginFile = (filePath: string): boolean =>
  (PLUGIN_EXTENSIONS as readonly string[]).includes(path.extname(filePath).toLowerCase());

/** Rows a localized plugin will produce once its STRINGS tables are read. */
const describePlugin = (title: CreationEngineTitle, pluginPath: string): AnchorDescription => {
  const esp = new EspReader(pluginPath, title.subrecords);
  const espRows = esp.extractStrings();
  if (!esp.info.isLocalized) return { isLocalized: false, totalRecords: espRows.length };

  const localeSources = discoverLocaleSources(
    pluginPath,
    title,
    discoverArchiveCandidatesForPlugin(pluginPath),
  );
  const totalRecords =
    localeSources.length > 0
      ? estimateLocalizedImportTotal(
          espRows,
          localeSources,
          localeSources.map((source) => source.locale),
          title.recorddefs,
        )
      : espRows.length;
  return { isLocalized: true, totalRecords };
};

/** Ingest a plugin: ESP strings, then the loose text that ships beside it. */
const ingestPlugin = async (
  title: CreationEngineTitle,
  ctx: ModImportRunContext,
): Promise<void> => {
  const prep = await prepareEspImportContext(title, ctx);
  const espOk = await importEspStringRows(title, ctx, prep);
  if (!espOk) return;
  await prep.batch.commitOpenTx();

  const stopped = () => ctx.state.cancel || ctx.state.pause;

  if (!stopped()) await importMcmStringRows(ctx);
  if (!stopped()) await importInterfaceTranslateRows(ctx);
  if (!stopped()) {
    await importPexStringRows(ctx, prep.batch);
    await prep.batch.commitOpenTx();
  }
  if (stopped()) return;

  await finalizeModImport(ctx, {
    importedLocaleTables: prep.localeSources.length > 0,
    afterConvert: async () => {
      await importCreationEngineDialogGraph(ctx, prep.esp, prep.dialogGraphCtx);
      await indexVoiceClips(ctx);
    },
  });
};

/** Ingest a package with no plugin: MCM, Interface, and PEX text only. */
const ingestExtrasOnly = async (ctx: ModImportRunContext): Promise<void> => {
  logImport.info(
    `[Mod Import #${ctx.job.id}] No plugin anchor — importing MCM/Interface/PEX text only`,
  );
  const { batch } = prepareExtrasOnlyImportContext(ctx);
  const stopped = () => ctx.state.cancel || ctx.state.pause;

  if (!stopped()) await importMcmStringRows(ctx);
  if (!stopped()) await importInterfaceTranslateRows(ctx);
  if (!stopped()) {
    await importPexStringRows(ctx, batch);
    await batch.commitOpenTx();
  }
  if (stopped()) return;

  await finalizeModImport(ctx, {
    importedLocaleTables: false,
    afterConvert: () => indexVoiceClips(ctx),
  });
};

/**
 * Index the mod's voice takes so the editor can pair audio with dialogue.
 * Non-fatal: a mod with unreadable audio still imports its text.
 */
const indexVoiceClips = async (ctx: ModImportRunContext): Promise<void> => {
  try {
    const voiceIndex = await persistBethesdaVoiceClips(
      ctx.db,
      ctx.importModId!,
      ctx.pluginStringLang,
    );
    if (voiceIndex.clips > 0 || voiceIndex.variants > 0) {
      logImport.info(
        `[Mod Import #${ctx.job.id}] Voice index: ${voiceIndex.variants} response variant(s), ${voiceIndex.clips} clip(s)`,
      );
    }
  } catch (err) {
    logImport.warn(
      `[Mod Import #${ctx.job.id}] Voice clip persist failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
};

export const createCreationEngineImportAdapter = (
  title: CreationEngineTitle,
): GameImportAdapter => ({
  uploadExtensions: PLUGIN_EXTENSIONS,

  selectAnchor: (extractDir) => {
    const primaryPlugins = filterPrimaryPlugins(discoverModFiles(extractDir).plugins);
    if (primaryPlugins.length > 0) return primaryPlugins[0]!;
    return hasMcmTranslationFiles(extractDir) ? findFirstMcmTranslationFile(extractDir) : null;
  },

  describeAnchor: (anchorPath) => {
    if (isPluginFile(anchorPath)) return describePlugin(title, anchorPath);
    return {
      isLocalized: false,
      totalRecords: countMcmTranslationRecords(resolveModDirectoryFromPath(anchorPath), anchorPath),
    };
  },

  refreshDialogSpeakers: (ctx) => refreshCreationEngineDialogSpeakers(title, ctx),

  ingest: async (ctx) => {
    try {
      if (isPluginFile(ctx.anchorPath)) return await ingestPlugin(title, ctx);
      return await ingestExtrasOnly(ctx);
    } finally {
      // Readers hold BA2 handles open for the whole walk. Releasing them is
      // this engine's business, so it happens here rather than in the shared
      // runner's `finally`, which would otherwise have to know about archives.
      clearBa2Cache();
    }
  },
});
