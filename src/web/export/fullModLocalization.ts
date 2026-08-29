/**
 * Apply translated plugin / Interface / MCM assets into a staging package dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { isPluginPath } from '../../import/mod/discovery';
import { log } from '../../logger';
import {
  pluginRelPath,
  pluginSiblingRelPath,
  toDiskPath,
  type ImportPackageContext,
} from '../../modImport/packages';
import type { GameType } from '../../types';
import { ensureDir } from '../../utils/file';
import { exportPatchedEsp } from './exportEsp';
import { exportPatchedFontFiles } from './exportFontPatch';
import { applyInterfaceLocalizeAssets, exportInterfaceTranslateFile } from './exportInterfacePatch';
import { exportLocalizedStringsFiles } from './exportLocalizedStrings';
import { exportMcmTranslationFiles } from './exportMcmPatch';
import { exportPatchedPexFiles } from './exportPex';
import type { ExportedStringsFile } from './exportTypes';

const exportedFileToBuffer = (file: ExportedStringsFile): Buffer =>
  Buffer.from(file.contentBase64, 'base64');

const writeBufferToPackage = (packageDir: string, relPath: string, data: Buffer): void => {
  const dest = toDiskPath(packageDir, relPath);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, data);
};

export const applyLocalizationToPackage = async (
  db: Tx,
  modId: number,
  pkg: ImportPackageContext,
  packageDir: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
  isLocalized: boolean,
): Promise<void> => {
  const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);

  if (isLocalized) {
    try {
      const stringsFiles = await exportLocalizedStringsFiles(
        db,
        modId,
        pkg.pluginPath,
        srcLang,
        targetLang,
        game,
      );
      for (const file of stringsFiles) {
        writeBufferToPackage(
          packageDir,
          pluginSiblingRelPath(pkg.packageDir, pkg.pluginPath, path.join('Strings', file.fileName)),
          exportedFileToBuffer(file),
        );
      }
    } catch {
      log.info(`Full mod export: no localized STRINGS for mod ${modId}`);
    }
    return;
  }

  if (isPluginPath(pkg.pluginPath)) {
    try {
      const esp = await exportPatchedEsp(db, modId, pkg.pluginPath, srcLang, targetLang);
      writeBufferToPackage(packageDir, pluginRel, exportedFileToBuffer(esp));
    } catch (espErr) {
      log.info(`Full mod export: ESP patch skipped for mod ${modId}: ${espErr}`);
      try {
        const stringsFiles = await exportLocalizedStringsFiles(
          db,
          modId,
          pkg.pluginPath,
          srcLang,
          targetLang,
          game,
        );
        for (const file of stringsFiles) {
          writeBufferToPackage(
            packageDir,
            pluginSiblingRelPath(
              pkg.packageDir,
              pkg.pluginPath,
              path.join('Strings', file.fileName),
            ),
            exportedFileToBuffer(file),
          );
        }
      } catch {
        log.info(`Full mod export: STRINGS fallback unavailable for mod ${modId}`);
      }
    }

    try {
      const pexFiles = await exportPatchedPexFiles(db, modId, pkg.pluginPath, srcLang, targetLang);
      for (const pex of pexFiles) {
        writeBufferToPackage(
          packageDir,
          pluginSiblingRelPath(pkg.packageDir, pkg.pluginPath, pex.fileName),
          exportedFileToBuffer(pex),
        );
      }
    } catch {
      log.info(`Full mod export: no patched PEX scripts for mod ${modId}`);
    }
  }

  try {
    const iface = await exportInterfaceTranslateFile(
      db,
      modId,
      pkg.pluginPath,
      srcLang,
      targetLang,
      game,
    );
    if (iface) {
      for (const file of iface) {
        writeBufferToPackage(
          packageDir,
          pluginSiblingRelPath(pkg.packageDir, pkg.pluginPath, file.archivePath),
          file.buffer,
        );
      }
    }
    const assetCount = applyInterfaceLocalizeAssets(pkg.pluginPath, targetLang, packageDir);
    if (assetCount > 0) {
      log.info(`Full mod export: merged ${assetCount} Interface asset(s) from localize overlay`);
    }
    for (const font of exportPatchedFontFiles(pkg.pluginPath, targetLang, game)) {
      writeBufferToPackage(
        packageDir,
        pluginSiblingRelPath(pkg.packageDir, pkg.pluginPath, font.archivePath),
        font.buffer,
      );
    }
  } catch (ifaceErr) {
    log.info(`Full mod export: Interface patch skipped for mod ${modId}: ${ifaceErr}`);
  }

  try {
    const mcmFiles = await exportMcmTranslationFiles(
      db,
      modId,
      pkg.pluginPath,
      srcLang,
      targetLang,
      game,
    );
    for (const file of mcmFiles) {
      writeBufferToPackage(packageDir, file.archivePath, file.buffer);
    }
    if (mcmFiles.length > 0) {
      log.info(`Full mod export: wrote ${mcmFiles.length} MCM translation file(s)`);
    }
  } catch (mcmErr) {
    log.info(`Full mod export: MCM patch skipped for mod ${modId}: ${mcmErr}`);
  }
};
