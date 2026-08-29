import path from 'node:path';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { writeBa2, usesBa2Archives } from '../../formats/ba2';
import { writeBsa } from '../../formats/bsa';
import { log } from '../../logger';
import {
  appendArchiveBuild,
  buildArchiveInputFile,
  resolveScriptsArchiveFileName,
  resolveStringsArchiveFileName,
  type ExportArchiveBuild,
} from './archiveExportPlan';
import { exportLocalizedStringsFiles } from './exportLocalizedStrings';
import { exportPatchedPexFiles } from './exportPex';
import type { ArchiveExportOptions, ExportedStringsFile } from './exportTypes';

const writeBuiltArchives = (
  builds: Map<string, ExportArchiveBuild>,
  game: GameType,
): ExportedStringsFile[] => {
  if (builds.size === 0) {
    throw new Error('No exportable STRINGS or PEX content for archive export');
  }

  const exported: ExportedStringsFile[] = [];
  for (const build of builds.values()) {
    const buf =
      build.archiveType === 'ba2'
        ? writeBa2(build.files)
        : writeBsa(build.files, game === 'sse' ? 105 : 104);
    exported.push({
      fileName: build.fileName,
      size: buf.length,
      contentBase64: buf.toString('base64'),
    });
  }

  exported.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' }),
  );
  return exported;
};

/**
 * Build one or more game archives with Creation Kit compression and naming rules.
 *
 * When string tables originally lived in `{Stem} - Interface.ba2`, they are repacked
 * there and patched PEX scripts go to `{Stem} - Main.ba2`.
 */
export const exportGameArchives = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile[]> => {
  const includeScripts = options.includeScripts !== false;
  const archiveType = usesBa2Archives(game) ? 'ba2' : 'bsa';
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const scriptsArchiveFileName = resolveScriptsArchiveFileName(stem, stringsArchiveFileName, game);
  const builds = new Map<string, ExportArchiveBuild>();

  try {
    const stringsFiles = await exportLocalizedStringsFiles(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      game,
    );
    appendArchiveBuild(
      builds,
      archiveType,
      stringsArchiveFileName,
      stringsFiles.map((file) =>
        buildArchiveInputFile(
          archiveType,
          stringsArchiveFileName,
          `Strings\\${file.fileName}`,
          Buffer.from(file.contentBase64, 'base64'),
          game,
        ),
      ),
    );
    log.info(
      `Archive export: prepared ${stringsFiles.length} STRINGS file(s) for ${stringsArchiveFileName}`,
    );
  } catch {
    log.info(`Archive export: no localized STRINGS for mod ${modId}, skipping strings tables`);
  }

  if (includeScripts) {
    try {
      const pexFiles = await exportPatchedPexFiles(db, modId, modPath, srcLang, targetLang);
      appendArchiveBuild(
        builds,
        archiveType,
        scriptsArchiveFileName,
        pexFiles.map((file) =>
          buildArchiveInputFile(
            archiveType,
            scriptsArchiveFileName,
            file.fileName,
            Buffer.from(file.contentBase64, 'base64'),
            game,
          ),
        ),
      );
      log.info(
        `Archive export: prepared ${pexFiles.length} PEX script(s) for ${scriptsArchiveFileName}`,
      );
    } catch {
      log.info(`Archive export: no patched PEX scripts for mod ${modId}, skipping scripts`);
    }
  }

  return writeBuiltArchives(builds, game);
};

/**
 * Export a single archive that contains translated strings tables.
 *
 * For Fallout 4/76, this produces a BA2 archive. For Skyrim/FO3/FNV, this
 * produces a BSA archive. The choice is automatic based on {@link GameType}.
 *
 * When both Interface (strings) and Main (scripts) archives are required, this
 * returns only the strings archive. Use {@link exportGameArchives} for all outputs.
 */
export const exportBa2Archive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile> => {
  const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, options);
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const stringsArchive =
    archives.find((archive) => archive.fileName === stringsArchiveFileName) ?? archives[0];
  if (!stringsArchive) {
    throw new Error(`No exportable STRINGS or PEX content for mod ${modId}`);
  }
  return stringsArchive;
};

/**
 * Builds a BSA v105 archive containing localized STRINGS/DLSTRINGS/ILSTRINGS
 * files.  This is the Skyrim SE equivalent of exportBa2Archive.
 */
export const exportBsaArchive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'sse',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile> => {
  const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, options);
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const stringsArchive =
    archives.find((archive) => archive.fileName === stringsArchiveFileName) ?? archives[0];
  if (!stringsArchive) {
    throw new Error(`No exportable STRINGS or PEX content for mod ${modId}`);
  }
  return stringsArchive;
};

/**
 * Game-aware archive dispatcher: exports a BA2 for Fallout 4/76 or a BSA for
 * Skyrim SE / Skyrim LE / Fallout 3 / Fallout NV.
 */
export const exportArchive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile> => {
  const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, options);
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const stringsArchive =
    archives.find((archive) => archive.fileName === stringsArchiveFileName) ?? archives[0];
  if (!stringsArchive) {
    throw new Error(`No exportable STRINGS or PEX content for mod ${modId}`);
  }
  return stringsArchive;
};
