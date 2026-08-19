import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { log } from '../../logger';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import { exportGameArchives } from './exportArchives';
import { exportPatchedEsp } from './exportEsp';
import { collectLangpackEntries } from './langpackCollect';
import { packFilesToZip } from './zipPack';

export { packFilesToZip } from './zipPack';

const emptyLangpackError = (game: GameType): string =>
  game === 'disco'
    ? 'No exportable Disco langpack content — no translated .po or localized .wav files available.'
    : 'No exportable langpack content found — no translated STRINGS, PEX, MCM, Interface, voice, or ESP patches available.';

/**
 * Builds a langpack ZIP with loose localization files only (no BA2/BSA).
 *
 * Includes only files that contain at least one translated string:
 * - STRINGS/DLSTRINGS/ILSTRINGS under `Strings\`
 * - patched ESP/ESM when the binary differs from the imported original
 * - patched PEX scripts under `Scripts\` when literals were translated
 * - synthesized voice files under `Sound\Voice\` as localized `.fuz`
 */
export const exportLangpackZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}_langpack.zip`;
  const files = await collectLangpackEntries(db, modId, modPath, srcLang, targetLang, game);
  if (files.length === 0) {
    throw new Error(emptyLangpackError(game));
  }

  const zipBuffer = await packFilesToZip(files);
  const label = game === 'disco' ? 'Disco langpack' : 'Langpack export';
  log.info(`${label}: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
  return { zipBuffer, zipFileName };
};

/**
 * Builds a full localized mod ZIP from the import extract tree.
 *
 * Repacks all BA2/BSA archives with translated content and includes every other
 * mod asset (meshes, textures, plugins, pass-through archives) from the import.
 */
export const exportFullModZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  if (game === 'disco') {
    // Final Cut packs are language folders — same payload as the langpack zip.
    return exportLangpackZip(db, modId, modPath, srcLang, targetLang, game);
  }

  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}.zip`;

  const { stageFullLocalizedMod } = await import('./fullModStaging');
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (extractRoot) {
    const staging = await stageFullLocalizedMod(db, modId, modPath, srcLang, targetLang, game);
    try {
      const zipBuffer = await packFilesToZip(staging.files);
      log.info(
        `Full mod export: ZIP ready — ${staging.files.length} file(s), ${zipBuffer.length} bytes`,
      );
      return { zipBuffer, zipFileName };
    } finally {
      staging.cleanup();
    }
  }

  log.warn(
    `Full mod export: no import extract tree for mod ${modId}, falling back to translation-only archives`,
  );
  const files: Array<{ name: string; data: Buffer }> = [];

  try {
    const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game);
    for (const archive of archives) {
      files.push({
        name: archive.fileName,
        data: Buffer.from(archive.contentBase64, 'base64'),
      });
    }
  } catch {
    log.info(`Full mod export: no localized STRINGS for mod ${modId}, skipping archive`);
  }

  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    files.push({
      name: esp.fileName,
      data: Buffer.from(esp.contentBase64, 'base64'),
    });
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
