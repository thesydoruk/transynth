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
import { readModWorkspaceManifest, type ModWorkspacePackage } from './archiveManifest';

export type LocalizeModWorkspaceOptions = {
  workspaceDir: string;
  modId?: number;
  tgtLang?: string;
  srcLang?: string;
  game?: GameType;
};

export type LocalizeModWorkspaceResult = {
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

export type WorkspacePackageContext = {
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

export const resolveDbModForWorkspace = async (
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

export const resolveWorkspacePackages = (
  workspaceDir: string,
  manifestPackages?: ModWorkspacePackage[],
): WorkspacePackageContext[] => {
  const extractedDir = path.join(workspaceDir, 'extracted');
  const localizeRoot = path.join(workspaceDir, 'localize');

  if (!fs.existsSync(extractedDir)) {
    throw new Error(`extracted/ not found in workspace: ${workspaceDir}`);
  }

  if (manifestPackages && manifestPackages.length > 0) {
    return manifestPackages.map((pkg) => {
      const packageDir = pkg.folder ? path.join(extractedDir, pkg.folder) : extractedDir;
      const pluginFile = pkg.pluginFiles[0];
      if (!pluginFile)
        throw new Error(`Package "${pkg.folder || '(root)'}" has no plugin in manifest`);
      const pluginPath = path.join(packageDir, pluginFile);
      if (!fs.existsSync(pluginPath)) {
        throw new Error(`Plugin not found in workspace: ${pluginPath}`);
      }
      return {
        folder: pkg.folder,
        packageDir,
        pluginPath,
        localizeDir: pkg.folder ? path.join(localizeRoot, pkg.folder) : localizeRoot,
      };
    });
  }

  const plugins = discoverModFiles(extractedDir).plugins;
  if (plugins.length === 0) {
    throw new Error(`No plugins found under ${extractedDir}`);
  }

  const pluginDirs = new Map<string, string>();
  for (const plugin of plugins) {
    const relDir = path.relative(extractedDir, path.dirname(plugin));
    const folder = relDir === '.' ? '' : relDir;
    if (!pluginDirs.has(folder)) pluginDirs.set(folder, plugin);
  }

  return [...pluginDirs.entries()].map(([folder, pluginPath]) => ({
    folder,
    packageDir: folder ? path.join(extractedDir, folder) : extractedDir,
    pluginPath,
    localizeDir: folder ? path.join(localizeRoot, folder) : localizeRoot,
  }));
};

const localizeWorkspacePackage = async (
  db: Tx,
  mod: ResolvedDbMod,
  pkg: WorkspacePackageContext,
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

export const localizeModWorkspace = async (
  db: Tx,
  options: LocalizeModWorkspaceOptions,
): Promise<LocalizeModWorkspaceResult> => {
  const workspaceDir = path.resolve(options.workspaceDir);
  const manifest = readModWorkspaceManifest(workspaceDir);
  const lookupName = manifest?.modName?.trim() || path.basename(workspaceDir);

  const mod = await resolveDbModForWorkspace(db, lookupName, options.modId);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const game = options.game ?? manifest?.game ?? mod.game;

  const packages = resolveWorkspacePackages(workspaceDir, manifest?.packages);
  const localizeDir = path.join(workspaceDir, 'localize');
  ensureDir(localizeDir);

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  log.info(
    `Localizing workspace "${lookupName}" → localize/ (mod id=${mod.modId}, ${srcLang}→${tgtLang}, game=${game})`,
  );

  for (const pkg of packages) {
    await localizeWorkspacePackage(
      db,
      mod,
      pkg,
      srcLang,
      tgtLang,
      game,
      written,
      skipped,
      warnings,
    );
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
