/**
 * The Witcher 3 ingestion.
 *
 * A mod, a DLC folder or the whole game is a tree of `content` folders holding
 * one `.w3strings` table per language, the voice beside them, and the scene
 * files that say who speaks each line. One phase reads them all; the shared
 * finalizer does the rest.
 */
import { logImport } from '../../../logging/loggers';
import { finalizeModImport } from '../../../import/mod/run/finalize';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from '../../../import/mod/localeHelpers';
import type { GameImportAdapter } from '../../contract';
import { listW3StringsFiles, resolveW3SourceLang } from '../packLayout';
import { countW3SourceStrings } from './tables';
import { importW3StringTables } from './stringsPhase';
import { planWitcher3FolderImport } from './folder';

export const witcher3ImportAdapter: GameImportAdapter = {
  // A bare `en.w3strings` says nothing about which `content` folder it came
  // from, which is half of every row's key and where the export must put it
  // back — so uploads are archives, or a folder through `import:folder`.
  uploadExtensions: [],

  selectAnchor: (extractDir) => {
    const files = listW3StringsFiles(extractDir);
    const sourceLang = resolveW3SourceLang(files, MOD_IMPORT_DEFAULT_SOURCE_LOCALE);
    return files.find((file) => file.lang === sourceLang)?.absPath ?? null;
  },

  describeAnchor: (_anchorPath, extractRoot) => ({
    // The text lives in string tables beside the content, not inside it.
    isLocalized: true,
    totalRecords: countW3SourceStrings(extractRoot, MOD_IMPORT_DEFAULT_SOURCE_LOCALE),
  }),

  planFolderImport: planWitcher3FolderImport,

  ingest: async (ctx) => {
    logImport.info(`[Mod Import #${ctx.job.id}] Importing Witcher 3 string tables`);
    if (ctx.state.cancel || ctx.state.pause) return;

    await importW3StringTables(ctx);
    if (ctx.state.cancel || ctx.state.pause) return;

    // Every language came from the game's own tables, so the finalizer promotes
    // the non-source strings to translations (see `stringsPhase.ts`).
    await finalizeModImport(ctx, { importedLocaleTables: true });
  },
};
