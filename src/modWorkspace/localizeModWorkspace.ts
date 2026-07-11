import fs from 'node:fs';
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
import { discoverModFiles } from '../web/import/modImportService';

export type LocalizeModImportOptions = {
  extractDir: string;
  pluginPath?: string;
  modId?: number;
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

export type ResolvedDbMod = {
  modId: number;
  modName: string;
  srcLang: string;
  game: GameType;
  isLocalized: boolean;
};

export type ImportPackageContext = {
  folder: string;
  packageDir: string;
  pluginPath: string;
  localizeDir: string;
};

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Plugin path relative to the package root (e.g. `Data/Mod.esp`). */
export const pluginRelPath = (packageDir: string, pluginPath: string): string =>
  normalizeRelPath(path.relative(packageDir, pluginPath));

/**
 * Resolve archive-relative asset paths next to the plugin (Scripts/, Strings/, Sound/, …).
 * Keeps `localize/` mirroring `extracted/` (e.g. `Data/Scripts/Foo.pex`, not `Scripts/Foo.pex`).
 */
export const pluginSiblingRelPath = (
  packageDir: string,
  pluginPath: string,
  siblingRel: string,
): string => {
  const pluginDir = path.dirname(pluginRelPath(packageDir, pluginPath));
  const sibling = normalizeRelPath(siblingRel);
  return pluginDir === '.' ? sibling : normalizeRelPath(path.join(pluginDir, sibling));
};

const toDiskPath = (rootDir: string, relPath: string): string => {
  const parts = normalizeRelPath(relPath).split('/').filter(Boolean);
  return path.join(rootDir, ...parts);
};

/** Write `data` when it differs from `baselinePath` (or baseline is missing). */
export const writeIfChanged = (
  destPath: string,
  data: Buffer,
  baselinePath: string | null,
): boolean => {
  if (baselinePath && fs.existsSync(baselinePath)) {
    const baseline = fs.readFileSync(baselinePath);
    if (baseline.equals(data)) return false;
  }

  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, data);
  return true;
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

export const resolveDbModForImport = async (
  db: Tx,
  modName: string,
  modId?: number,
): Promise<ResolvedDbMod> => {
  if (modId != null) {
    const { rows } = await db.query<{
      mod_id: number;
      mod_name: string;
      src_lang: string | null;
      game: string | null;
      is_localized: number | null;
    }>(
      `SELECT DISTINCT ON (m.id)
          m.id AS mod_id,
          m.name AS mod_name,
          mi.src_lang,
          COALESCE(m.game, mi.game, 'fo4') AS game,
          mi.is_localized
       FROM mods m
       JOIN mod_imports mi ON mi.mod_id = m.id AND mi.status = 'completed'
       WHERE m.id = $1
       ORDER BY m.id, mi.updated_at DESC`,
      [modId],
    );
    const row = rows[0];
    if (!row) throw new Error(`Mod id=${modId} not found or has no completed import`);
    return {
      modId: row.mod_id,
      modName: row.mod_name,
      srcLang: row.src_lang?.trim() || CONFIG.defaultSrcLang,
      game: (row.game ?? 'fo4') as GameType,
      isLocalized: (row.is_localized ?? 0) === 1,
    };
  }

  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    src_lang: string | null;
    game: string | null;
    is_localized: number | null;
  }>(
    `SELECT DISTINCT ON (m.id)
        m.id AS mod_id,
        m.name AS mod_name,
        mi.src_lang,
        COALESCE(m.game, mi.game, 'fo4') AS game,
        mi.is_localized
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id AND mi.status = 'completed'
     WHERE lower(m.name) = lower($1)
     ORDER BY m.id, mi.updated_at DESC`,
    [modName],
  );

  if (rows.length === 0) {
    throw new Error(`No imported mod found in database with name "${modName}" (use --mod-id)`);
  }
  if (rows.length > 1) {
    const ids = rows.map((r) => r.mod_id).join(', ');
    throw new Error(`Multiple mods named "${modName}" in database: ${ids} — use --mod-id`);
  }

  const row = rows[0]!;
  return {
    modId: row.mod_id,
    modName: row.mod_name,
    srcLang: row.src_lang?.trim() || CONFIG.defaultSrcLang,
    game: (row.game ?? 'fo4') as GameType,
    isLocalized: (row.is_localized ?? 0) === 1,
  };
};

export const resolveImportPackages = (
  extractDir: string,
  primaryPluginPath?: string,
): ImportPackageContext[] => {
  const resolvedExtractDir = path.resolve(extractDir);
  const localizeRoot = path.join(resolvedExtractDir, 'localize');

  if (!fs.existsSync(resolvedExtractDir)) {
    throw new Error(`Import extract directory not found: ${resolvedExtractDir}`);
  }

  if (primaryPluginPath) {
    const pluginPath = path.resolve(primaryPluginPath);
    const folder = path.relative(resolvedExtractDir, path.dirname(pluginPath));
    const normalizedFolder = folder === '.' ? '' : folder.replace(/\\/g, '/');
    return [
      {
        folder: normalizedFolder,
        packageDir: path.dirname(pluginPath),
        pluginPath,
        localizeDir: normalizedFolder ? path.join(localizeRoot, normalizedFolder) : localizeRoot,
      },
    ];
  }

  const plugins = discoverModFiles(resolvedExtractDir).plugins;
  if (plugins.length === 0) {
    throw new Error(`No plugins found under ${resolvedExtractDir}`);
  }

  const pluginDirs = new Map<string, string>();
  for (const plugin of plugins) {
    const relDir = path.relative(resolvedExtractDir, path.dirname(plugin));
    const folder = relDir === '.' ? '' : relDir.replace(/\\/g, '/');
    if (!pluginDirs.has(folder)) pluginDirs.set(folder, plugin);
  }

  return [...pluginDirs.entries()].map(([folder, pluginPath]) => ({
    folder,
    packageDir: folder ? path.join(resolvedExtractDir, folder) : resolvedExtractDir,
    pluginPath,
    localizeDir: folder ? path.join(localizeRoot, folder) : localizeRoot,
  }));
};

const localizeImportPackage = async (
  db: Tx,
  mod: ResolvedDbMod,
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
  const mod = await resolveDbModForImport(db, path.basename(extractDir), options.modId);
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
