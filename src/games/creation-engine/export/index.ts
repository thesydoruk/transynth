/**
 * Creation Engine export.
 *
 * A Bethesda langpack is loose files a player drops into `Data\`; a full mod
 * export is the whole extracted package with its archives repacked around the
 * translated content.
 */
import path from 'node:path';
import { log } from '../../../logger';
import { resolveModImportExtractRoot } from '../../../modStorage/paths';
import { exportGameArchives } from '../../../web/export/exportArchives';
import { exportPatchedEsp } from '../../../web/export/exportEsp';
import type { ZipPackEntry } from '../../../web/export/exportTypes';
import { stageFullLocalizedMod } from '../../../web/export/fullModStaging';
import {
  UA_SOUND_PACK_BA2,
  UA_SOUND_PACK_ESP,
  splitLangpackVoiceEntries,
  writeUaSoundPackIntoDir,
} from '../../../web/export/uaSoundPack';
import { packFilesToZip } from '../../../web/export/zipPack';
import type { ExportedZip, GameExportAdapter, ModExportContext } from '../../contract';
import type { CreationEngineTitle } from '../title';
import { collectCreationEngineLangpackEntries } from './langpack';

/**
 * Repack synthesized voice into an uncompressed BA2 plus a dummy plugin.
 *
 * Fallout 4 will not play loose `.fuz` takes, so its langpack has to ship them
 * inside an archive the engine loads. Titles that play loose audio skip this.
 */
const packVoiceIntoSoundPack = (entries: ZipPackEntry[], stagingDir: string): ZipPackEntry[] => {
  const { rest, voice } = splitLangpackVoiceEntries(entries);
  if (voice.length === 0) return rest;

  writeUaSoundPackIntoDir(stagingDir, voice);
  return [
    ...rest,
    { name: UA_SOUND_PACK_ESP, absPath: path.join(stagingDir, UA_SOUND_PACK_ESP) },
    { name: UA_SOUND_PACK_BA2, absPath: path.join(stagingDir, UA_SOUND_PACK_BA2) },
  ];
};

/**
 * Fall back to translation-only archives when the mod was imported before the
 * extract tree existed. The result installs over the original mod.
 */
const exportTranslationsOnly = async (
  ctx: ModExportContext,
  game: string,
  zipFileName: string,
): Promise<ExportedZip> => {
  const { db, modId, modPath, srcLang, targetLang } = ctx;
  const files: Array<{ name: string; data: Buffer }> = [];

  try {
    const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game);
    for (const archive of archives) {
      files.push({ name: archive.fileName, data: Buffer.from(archive.contentBase64, 'base64') });
    }
  } catch {
    log.info(`Full mod export: no localized STRINGS for mod ${modId}, skipping archive`);
  }

  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    files.push({ name: esp.fileName, data: Buffer.from(esp.contentBase64, 'base64') });
  } catch {
    log.info(`Full mod export: no non-localized patches for mod ${modId}, skipping ESP`);
  }

  if (files.length === 0) {
    throw new Error(
      'No exportable content found — no localized STRINGS archive or non-localized ESP patches available.',
    );
  }

  const zipBuffer = await packFilesToZip(files);
  log.info(`Full mod export: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
  return { zipBuffer, zipFileName };
};

export const createCreationEngineExportAdapter = (
  title: CreationEngineTitle,
): GameExportAdapter => ({
  collectLangpackEntries: (ctx) => collectCreationEngineLangpackEntries({ ...ctx, game: title.id }),

  emptyLangpackMessage:
    'No exportable langpack content found — no translated STRINGS, PEX, MCM, Interface, voice, or ESP patches available.',

  logLabel: 'Langpack export',

  finalizeLangpackEntries: title.voice.packLangpackVoiceIntoBa2
    ? (entries, stagingDir) => packVoiceIntoSoundPack(entries, stagingDir)
    : undefined,

  exportFullModZip: async (ctx) => {
    const stem = path.basename(ctx.modPath, path.extname(ctx.modPath));
    const zipFileName = `${stem}_${ctx.targetLang}.zip`;

    if (!resolveModImportExtractRoot(ctx.modPath)) {
      log.warn(
        `Full mod export: no import extract tree for mod ${ctx.modId}, falling back to translation-only archives`,
      );
      return exportTranslationsOnly(ctx, title.id, zipFileName);
    }

    const staging = await stageFullLocalizedMod(
      ctx.db,
      ctx.modId,
      ctx.modPath,
      ctx.srcLang,
      ctx.targetLang,
      title.id,
    );
    try {
      const zipBuffer = await packFilesToZip(staging.files);
      log.info(
        `Full mod export: ZIP ready — ${staging.files.length} file(s), ${zipBuffer.length} bytes`,
      );
      return { zipBuffer, zipFileName };
    } finally {
      staging.cleanup();
    }
  },
});
