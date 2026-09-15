/**
 * Disco Elysium ingestion.
 *
 * A Final Cut pack is a folder per language holding gettext `.po` catalogues
 * and an `Audio/` folder of `.wav` takes — no plugin, no archives, no string
 * tables. One phase reads the catalogues; the shared finalizer does the rest.
 */
import { logImport } from '../../../logging/loggers';
import { finalizeModImport } from '../../../import/mod/run/finalize';
import type { GameImportAdapter } from '../../contract';
import { findFirstDiscoPoFile, hasDiscoPoPack } from '../packLayout';
import { countDiscoPoTranslationRecords } from './poLocales';
import { importDiscoPoStringRows } from './poPhase';
import { refreshDiscoSpeakerGenders } from './refreshSpeakerGenders';

export const discoImportAdapter: GameImportAdapter = {
  // Final Cut packs are always distributed as archives of language folders;
  // a bare `.po` on its own carries no locale or audio context.
  uploadExtensions: [],

  selectAnchor: (extractDir) =>
    hasDiscoPoPack(extractDir) ? findFirstDiscoPoFile(extractDir) : null,

  describeAnchor: (_anchorPath, extractRoot) => ({
    isLocalized: false,
    totalRecords: countDiscoPoTranslationRecords(extractRoot),
  }),

  /**
   * Nothing to re-read from disk — the speakers are already named from the
   * `.wav` stems. What this fills in is their gender, from the catalogue text
   * the database already holds.
   */
  refreshDialogSpeakers: refreshDiscoSpeakerGenders,

  ingest: async (ctx) => {
    logImport.info(`[Mod Import #${ctx.job.id}] Importing Disco Final Cut .po pack`);
    if (ctx.state.cancel || ctx.state.pause) return;

    await importDiscoPoStringRows(ctx);
    if (ctx.state.cancel || ctx.state.pause) return;

    await finalizeModImport(ctx, { importedLocaleTables: false });
  },
};
