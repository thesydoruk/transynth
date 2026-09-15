/**
 * Disco Elysium export.
 *
 * A Final Cut pack is a language folder — `.po` catalogues plus localized
 * `.wav` under `Audio/`. There is no plugin to patch and no archive to repack,
 * so a full-mod export is the same payload as a langpack.
 */
import path from 'node:path';
import { packFilesToZip } from '../../../web/export/zipPack';
import { log } from '../../../logger';
import type { GameExportAdapter } from '../../contract';
import { collectDiscoLangpackEntries } from './langpack';

export const discoExportAdapter: GameExportAdapter = {
  collectLangpackEntries: collectDiscoLangpackEntries,

  emptyLangpackMessage:
    'No exportable Disco langpack content — no translated .po or localized .wav files available.',

  logLabel: 'Disco langpack',

  exportFullModZip: async (ctx) => {
    const stem = path.basename(ctx.modPath, path.extname(ctx.modPath));
    const zipFileName = `${stem}_${ctx.targetLang}.zip`;
    const files = await collectDiscoLangpackEntries(ctx);
    if (files.length === 0) throw new Error(discoExportAdapter.emptyLangpackMessage);

    const zipBuffer = await packFilesToZip(files);
    log.info(`Disco langpack: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
    return { zipBuffer, zipFileName };
  },
};
