import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { patchStringsMap } from '../../formats/esp';
import { patchPexBuffer, collectModPexSources } from '../../formats/pex';
import { writeStringsBuffer } from '../../formats/strings';
import { log } from '../../logger';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import { exportGameArchives } from './exportArchives';
import { exportPatchedEsp } from './exportEsp';
import { getPexTranslationOverlays } from './exportPex';
import { collectLocalizedVoiceFiles } from './exportVoiceFiles';
import { collectInterfacePatchEntries } from './exportInterfacePatch';
import type { ZipPackEntry } from './exportTypes';
import { loadSourceStringsFiles } from './sourceStringsLoader';
import { getTranslationOverlaysByType, hasTranslationOverlayChanges } from './translationOverlay';

export const packFilesToZip = async (files: ZipPackEntry[]): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { store: true });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const file of files) {
      if (file.data) {
        archive.append(file.data, { name: file.name });
        continue;
      }
      if (file.absPath) {
        archive.file(file.absPath, { name: file.name });
        continue;
      }
      reject(new Error(`ZIP entry "${file.name}" has no data source`));
      return;
    }

    archive.finalize();
  });

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
  const files: ZipPackEntry[] = [];

  try {
    const sourceFiles = loadSourceStringsFiles(modPath, srcLang, game);
    const overlays = await getTranslationOverlaysByType(db, modId, srcLang, targetLang, game);
    let stringsCount = 0;
    for (const sourceFile of sourceFiles) {
      const overlay = overlays.get(sourceFile.type) ?? new Map();
      if (!hasTranslationOverlayChanges(sourceFile.sourceMap, overlay)) continue;
      const patched = patchStringsMap(sourceFile.sourceMap, overlay);
      const buf = writeStringsBuffer(patched, sourceFile.type);
      const fileName = `${sourceFile.nameStem}_${targetLang.toLowerCase()}.${sourceFile.type}`;
      files.push({ name: `Strings/${fileName}`, data: buf });
      stringsCount++;
    }
    if (stringsCount > 0) {
      log.info(
        `Langpack export: included ${stringsCount} changed STRINGS file(s) for mod ${modId}`,
      );
    }
  } catch (err) {
    log.info(
      `Langpack export: no localized STRINGS for mod ${modId}, skipping strings tables (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    const patchedBuf = Buffer.from(esp.contentBase64, 'base64');
    const originalBuf = fs.readFileSync(modPath);
    if (!patchedBuf.equals(originalBuf)) {
      files.push({ name: esp.fileName, data: patchedBuf });
      log.info(`Langpack export: included patched ESP (${esp.size} bytes)`);
    }
  } catch {
    log.info(`Langpack export: no non-localized patches for mod ${modId}, skipping ESP`);
  }

  try {
    const overlays = await getPexTranslationOverlays(db, modId, srcLang, targetLang);
    const sources = collectModPexSources(modPath);
    let pexCount = 0;
    for (const [scriptKey, source] of sources) {
      const overlay = overlays.get(scriptKey);
      if (!overlay || overlay.size === 0) continue;
      const hasChanges = [...overlay.entries()].some(([src, exp]) => exp !== src);
      if (!hasChanges) continue;

      const patched = patchPexBuffer(source.data, overlay);
      const fileName =
        source.archivePath.replace(/\\/g, '/').split('/').pop() ?? `${scriptKey}.pex`;
      const archivePath = source.archivePath.includes('\\')
        ? source.archivePath
        : `Scripts\\${fileName}`;
      files.push({ name: archivePath.replace(/\\/g, '/'), data: patched });
      pexCount++;
    }
    if (pexCount > 0) {
      log.info(`Langpack export: included ${pexCount} changed PEX script(s) for mod ${modId}`);
    }
  } catch {
    log.info(`Langpack export: no patched PEX scripts for mod ${modId}, skipping Scripts`);
  }

  try {
    const voiceFiles = collectLocalizedVoiceFiles(modPath, targetLang);
    for (const voiceFile of voiceFiles) {
      files.push({ name: voiceFile.name, absPath: voiceFile.absPath });
    }
    if (voiceFiles.length > 0) {
      log.info(
        `Langpack export: included ${voiceFiles.length} localized voice file(s) for mod ${modId}`,
      );
    }
  } catch (err) {
    log.info(
      `Langpack export: no localized voice files for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const interfaceFiles = await collectInterfacePatchEntries(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      game,
    );
    files.push(...interfaceFiles);
  } catch (err) {
    log.info(
      `Langpack export: no Interface patch files for mod ${modId} (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  if (files.length === 0) {
    throw new Error(
      'No exportable langpack content found — no translated STRINGS, PEX scripts, voice files, or ESP patches available.',
    );
  }

  const zipBuffer = await packFilesToZip(files);
  log.info(`Langpack export: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
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

/**
 * Builds an Interface-only patch ZIP (Translate_*.txt + localize overlay assets).
 *
 * Matches the layout used by Fallout 4 UI localization mods: files under `Interface\`.
 */
export const exportInterfacePatchZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}_interface.zip`;
  const files = await collectInterfacePatchEntries(db, modId, modPath, srcLang, targetLang, game);

  if (files.length === 0) {
    throw new Error(
      'No exportable Interface content found — translate Interface/Translate_*.txt in the editor or add assets under _localize/{lang}/Interface/.',
    );
  }

  const zipBuffer = await packFilesToZip(files);
  log.info(`Interface export: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
  return { zipBuffer, zipFileName };
};
