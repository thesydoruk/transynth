import path from 'node:path';
import { CONFIG } from '../config';
import type { Tx } from '../db';
import { log } from '../logger';
import type { GameType } from '../types';
import { ensureDir } from '../utils/file';
import {
  exportLocalizedStringsFiles,
  exportPatchedEsp,
  exportPatchedPexFiles,
  type ExportedStringsFile,
} from '../web/export/exportService';
import {
  loadImportedMod,
  pluginRelPath,
  pluginSiblingRelPath,
  resolveImportPackages,
  writeIfChanged,
  type ImportPackageContext,
  type ImportedMod,
} from '../modImport';

export type LocalizeModImportOptions = {
  extractDir: string;
  pluginPath?: string;
  modId: number;
  tgtLang?: string;
  srcLang?: string;
  game?: GameType;
};

export type LocalizeModImportResult = {
  modId: number;
  modName: string;
  localizeDir: string;
  written: string[];
  skipped: string[];
  warnings: string[];
};

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const toDiskPath = (rootDir: string, relPath: string): string => {
  const parts = normalizeRelPath(relPath).split('/').filter(Boolean);
  return path.join(rootDir, ...parts);
};

const exportErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const exportedFileToBuffer = (file: ExportedStringsFile): Buffer =>
  Buffer.from(file.contentBase64, 'base64');

const trackWrite = (
  relPath: string,
  prefix: string,
  packageDir: string,
  localizeDir: string,
  data: Buffer,
  written: string[],
  skipped: string[],
): void => {
  const rel = normalizeRelPath(relPath);
  const dest = toDiskPath(localizeDir, rel);
  const baseline = toDiskPath(packageDir, rel);
  const label = prefix + rel;
  if (writeIfChanged(dest, data, baseline)) written.push(label);
  else skipped.push(label);
};

const localizeImportPackage = async (
  db: Tx,
  mod: ImportedMod,
  pkg: ImportPackageContext,
  srcLang: string,
  tgtLang: string,
  game: GameType,
  written: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> => {
  const prefix = pkg.folder ? `${pkg.folder}/` : '';
  log.info(`Localizing package ${prefix || '(root)'} from ${path.basename(pkg.pluginPath)}`);

  const writeStrings = async (): Promise<void> => {
    const stringsFiles = await exportLocalizedStringsFiles(
      db,
      mod.modId,
      pkg.pluginPath,
      srcLang,
      tgtLang,
      game,
    );
    for (const file of stringsFiles) {
      trackWrite(
        pluginSiblingRelPath(pkg.packageDir, pkg.pluginPath, path.join('Strings', file.fileName)),
        prefix,
        pkg.packageDir,
        pkg.localizeDir,
        exportedFileToBuffer(file),
        written,
        skipped,
      );
    }
  };

  const writeScripts = async (): Promise<void> => {
    const pexFiles = await exportPatchedPexFiles(db, mod.modId, pkg.pluginPath, srcLang, tgtLang);
    for (const pex of pexFiles) {
      trackWrite(
        pluginSiblingRelPath(pkg.packageDir, pkg.pluginPath, pex.fileName),
        prefix,
        pkg.packageDir,
        pkg.localizeDir,
        exportedFileToBuffer(pex),
        written,
        skipped,
      );
    }
  };

  if (mod.isLocalized) {
    try {
      await writeStrings();
    } catch (err) {
      warnings.push(`${prefix}STRINGS: ${exportErrorMessage(err)}`);
    }
    return;
  }

  try {
    const esp = await exportPatchedEsp(db, mod.modId, pkg.pluginPath, srcLang, tgtLang);
    trackWrite(
      pluginRelPath(pkg.packageDir, pkg.pluginPath),
      prefix,
      pkg.packageDir,
      pkg.localizeDir,
      exportedFileToBuffer(esp),
      written,
      skipped,
    );
  } catch (espErr) {
    try {
      await writeStrings();
    } catch (stringsErr) {
      warnings.push(
        `${prefix}ESP: ${exportErrorMessage(espErr)}; STRINGS: ${exportErrorMessage(stringsErr)}`,
      );
      return;
    }
    warnings.push(`${prefix}ESP: ${exportErrorMessage(espErr)} (used STRINGS fallback)`);
  }

  try {
    await writeScripts();
  } catch (err) {
    warnings.push(`${prefix}Scripts: ${exportErrorMessage(err)}`);
  }
};

export const localizeModImport = async (
  db: Tx,
  options: LocalizeModImportOptions,
): Promise<LocalizeModImportResult> => {
  const extractDir = path.resolve(options.extractDir);
  const mod = await loadImportedMod(db, options.modId);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const game = options.game ?? mod.game;

  const packages = resolveImportPackages(extractDir, options.pluginPath);
  const localizeDir = path.join(extractDir, 'localize');
  ensureDir(localizeDir);

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  log.info(
    `Localizing import "${mod.modName}" → ${localizeDir} (mod id=${mod.modId}, ${srcLang}→${tgtLang}, game=${game})`,
  );

  for (const pkg of packages) {
    await localizeImportPackage(db, mod, pkg, srcLang, tgtLang, game, written, skipped, warnings);
  }

  return {
    modId: mod.modId,
    modName: mod.modName,
    localizeDir,
    written,
    skipped,
    warnings,
  };
};
