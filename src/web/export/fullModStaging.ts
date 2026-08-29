import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { isPluginPath } from '../../import/mod/discovery';
import { log } from '../../logger';
import type { ArchiveManifestEntry, ModImportArchiveRecord } from '../../modImport/archiveManifest';
import { readModImportExtractManifest } from '../../modImport/archiveManifest';
import { isBethesdaArchiveFile, normalizeArchivePath } from '../../modImport/bethesdaArchivePaths';
import { loadImportedMod } from '../../modImport/importedMod';
import {
  manifestArchivedPaths,
  packBethesdaArchivesIntoDir,
  resolvePackageArchives,
  type PackedBethesdaArchive,
} from '../../modImport/packBethesdaArchives';
import { pluginRelPath, resolveImportPackages, toDiskPath } from '../../modImport/packages';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import type { GameType } from '../../types';
import { copyFileSafe, ensureDir } from '../../utils/file';
import { applyLocalizationToPackage } from './fullModLocalization';
import { collectExportableVoiceFiles } from './exportVoiceFiles';

const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);
const SKIP_STAGING_NAMES = new Set(['import-manifest.json', 'localize']);

const isPluginFile = (fileName: string): boolean =>
  PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());

const archivePackageFolder = (relativePath: string): string => {
  const norm = relativePath.replace(/\\/g, '/');
  const dir = path.posix.dirname(norm);
  return dir === '.' ? '' : dir;
};

const copyDirectory = (fromDir: string, toDir: string): void => {
  ensureDir(toDir);
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const src = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) copyDirectory(src, dest);
    else fs.copyFileSync(src, dest);
  }
};

const removeDirectory = (dir: string): void => {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
};

const resolvePackageArchivesFromManifest = (
  packageFolder: string,
  manifestArchives: ModImportArchiveRecord[],
): ArchiveManifestEntry[] =>
  manifestArchives
    .filter((archive) => archivePackageFolder(archive.relativePath) === packageFolder)
    .map((archive) => ({
      type: archive.packing,
      fileName: archive.fileName,
      entries: archive.entries,
      bsaVersion: archive.bsaVersion,
    }));

const writeBufferToPackage = (packageDir: string, relPath: string, data: Buffer): void => {
  const dest = toDiskPath(packageDir, relPath);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, data);
};

const isLocalizedVoiceRelPath = (relPath: string, game: GameType): boolean => {
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  if (game === 'disco') return /(^|\/)audio(\/|$)/.test(norm);
  return /(^|\/)sound\/voice(\/|$)/.test(norm);
};

const mergeLocalizeOverlay = (localizeDir: string, packageDir: string, game: GameType): void => {
  if (!fs.existsSync(localizeDir)) return;

  const walk = (current: string, rel = ''): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (isLocalizedVoiceRelPath(relPath, game)) continue;
      if (entry.isDirectory()) {
        walk(full, relPath);
        continue;
      }
      writeBufferToPackage(packageDir, relPath, fs.readFileSync(full));
    }
  };

  walk(localizeDir);
};

const applyExportableVoiceOverlay = async (
  db: Tx,
  modId: number,
  modPath: string,
  packageDir: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
): Promise<void> => {
  const voiceFiles = await collectExportableVoiceFiles(
    db,
    modId,
    modPath,
    srcLang,
    targetLang,
    game,
    { extensions: game === 'disco' ? ['.wav'] : ['.fuz'] },
  );
  for (const file of voiceFiles) {
    writeBufferToPackage(packageDir, file.packageRel, fs.readFileSync(file.absPath));
  }
};

const copyLooseFiles = (
  sourceDir: string,
  destDir: string,
  archivedPaths: Set<string>,
  skipArchiveNames: Set<string>,
): void => {
  const walk = (current: string, rel = ''): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const relNorm = normalizeArchivePath(relPath);
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        const hasArchivedChild = [...archivedPaths].some(
          (archived) => archived === relNorm || archived.startsWith(`${relNorm}/`),
        );
        if (!hasArchivedChild) {
          copyDirectory(full, path.join(destDir, relPath));
        } else {
          walk(full, relPath);
        }
        continue;
      }

      if (archivedPaths.has(relNorm)) continue;
      if (isPluginFile(entry.name)) {
        copyFileSafe(full, path.join(destDir, relPath));
        continue;
      }

      if (isBethesdaArchiveFile(entry.name)) {
        if (!skipArchiveNames.has(entry.name.toLowerCase())) {
          copyFileSafe(full, path.join(destDir, relPath));
        }
        continue;
      }

      copyFileSafe(full, path.join(destDir, relPath));
    }
  };

  walk(sourceDir);
};

const walkZipEntries = (
  rootDir: string,
  zipPrefix: string,
  out: Array<{ name: string; data: Buffer }>,
): void => {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    const rel = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkZipEntries(full, rel, out);
    else out.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(full) });
  }
};

const copyExtractRootExtras = (
  extractRoot: string,
  packageFolder: string,
  stagingDir: string,
): void => {
  for (const entry of fs.readdirSync(extractRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || SKIP_STAGING_NAMES.has(entry.name)) continue;
    if (entry.isDirectory()) {
      if (entry.name === packageFolder) continue;
      copyDirectory(path.join(extractRoot, entry.name), path.join(stagingDir, entry.name));
      continue;
    }
    copyFileSafe(path.join(extractRoot, entry.name), path.join(stagingDir, entry.name));
  }
};

export type FullModStagingResult = {
  files: Array<{ name: string; data: Buffer }>;
  cleanup: () => void;
};

/**
 * Stage a full localized mod from an import extract tree: apply translations,
 * rebuild BA2/BSA archives from manifest, and collect distributable files.
 */
export const stageFullLocalizedMod = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
): Promise<FullModStagingResult> => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) {
    throw new Error('Full mod export requires an import extract tree with archive manifest');
  }

  const mod = await loadImportedMod(db, modId);
  const packages = resolveImportPackages(extractRoot, targetLang, modPath);
  const pkg = packages[0];
  if (!pkg) {
    throw new Error(`No import package found for plugin ${modPath}`);
  }

  const manifest = readModImportExtractManifest(extractRoot);
  const manifestArchives = manifest?.archives ?? [];
  const packageArchives = resolvePackageArchivesFromManifest(pkg.folder, manifestArchives);
  const pluginFiles = isPluginPath(pkg.pluginPath)
    ? [pluginRelPath(pkg.packageDir, pkg.pluginPath)]
    : [];

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'full-mod-export-'));
  const effectiveDir = path.join(workRoot, 'effective');
  const packageStagingDir = path.join(workRoot, 'package');
  const finalStagingDir = path.join(workRoot, 'final');

  copyDirectory(pkg.packageDir, effectiveDir);
  mergeLocalizeOverlay(pkg.localizeDir, effectiveDir, game);
  await applyExportableVoiceOverlay(db, modId, modPath, effectiveDir, srcLang, targetLang, game);
  await applyLocalizationToPackage(
    db,
    modId,
    pkg,
    effectiveDir,
    srcLang,
    targetLang,
    game,
    mod.isLocalized,
  );

  ensureDir(packageStagingDir);
  const resolvedArchives = resolvePackageArchives(effectiveDir, packageArchives, pluginFiles, game);
  const packed = packBethesdaArchivesIntoDir(
    effectiveDir,
    packageStagingDir,
    packageArchives,
    pluginFiles,
    game,
  );
  const packedNames = new Set(
    packed.map((item: PackedBethesdaArchive) => item.fileName.toLowerCase()),
  );
  const archivedPaths = manifestArchivedPaths(resolvedArchives);
  copyLooseFiles(effectiveDir, packageStagingDir, archivedPaths, packedNames);

  ensureDir(finalStagingDir);
  if (pkg.folder) {
    copyDirectory(packageStagingDir, path.join(finalStagingDir, pkg.folder));
    copyExtractRootExtras(extractRoot, pkg.folder, finalStagingDir);
  } else {
    copyDirectory(packageStagingDir, finalStagingDir);
  }

  const files: Array<{ name: string; data: Buffer }> = [];
  walkZipEntries(finalStagingDir, '', files);

  if (files.length === 0) {
    removeDirectory(workRoot);
    throw new Error('Full mod export produced no files');
  }

  log.info(`Full mod export: staged ${files.length} file(s) from ${extractRoot}`);

  return {
    files,
    cleanup: () => removeDirectory(workRoot),
  };
};
