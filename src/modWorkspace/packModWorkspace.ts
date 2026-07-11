import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import type { GameType } from '../types';
import { copyFileSafe, ensureDir } from '../utils/file';
import { modImportPackOutputDir } from '../modStorage';
import { discoverModFiles } from '../web/import/modImportService';
import { type ArchiveManifestEntry, readModImportExtractManifest } from './archiveManifest';
import { isBethesdaArchiveFile, normalizeArchivePath } from './bethesdaArchivePaths';
import { create7zArchive } from './create7zArchive';
import {
  manifestArchivedPaths,
  packBethesdaArchivesIntoDir,
  resolvePackageArchives,
} from './packBethesdaArchives';

const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

type ImportPackPackage = {
  folder: string;
  pluginFiles: string[];
  archives: ArchiveManifestEntry[];
};

export type PackModImportOptions = {
  extractDir: string;
  modName?: string;
  pluginPath?: string;
  game?: GameType;
  outputDir?: string;
};

export type PackModImportResult = {
  modName: string;
  outputDir: string;
  archives: string[];
  bethesdaArchives: string[];
};

const removeDirectory = (dir: string): void => {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
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

const isPluginFile = (fileName: string): boolean =>
  PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());

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
          (p) => p === relNorm || p.startsWith(`${relNorm}/`),
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

const resolvePackageArchiveName = (pkg: ImportPackPackage): string => {
  const plugin = pkg.pluginFiles[0];
  if (plugin) return path.basename(plugin, path.extname(plugin));
  if (pkg.folder) return path.basename(pkg.folder);
  return 'mod';
};

const buildPackageStagingDir = (
  extractedDir: string,
  pkg: ImportPackPackage,
  stagingRoot: string,
  game: GameType,
): { stagingDir: string; bethesdaArchives: string[] } => {
  const packageDir = pkg.folder ? path.join(extractedDir, pkg.folder) : extractedDir;
  if (!fs.existsSync(packageDir)) {
    throw new Error(`Package folder not found: ${packageDir}`);
  }

  const stagingDir = path.join(stagingRoot, pkg.folder || '_root');
  removeDirectory(stagingDir);
  ensureDir(stagingDir);

  const resolvedArchives = resolvePackageArchives(packageDir, pkg.archives, pkg.pluginFiles, game);
  const packed = packBethesdaArchivesIntoDir(
    packageDir,
    stagingDir,
    resolvedArchives,
    pkg.pluginFiles,
    game,
  );
  const packedNames = new Set(packed.map((item) => item.fileName.toLowerCase()));
  const archivedPaths = manifestArchivedPaths(resolvedArchives);

  copyLooseFiles(packageDir, stagingDir, archivedPaths, packedNames);

  return {
    stagingDir,
    bethesdaArchives: packed.map((item) => item.destPath),
  };
};

const listTopLevelPackageFolders = (extractedDir: string): string[] => {
  const pluginDirs = new Set<string>();
  for (const plugin of discoverModFiles(extractedDir).plugins) {
    const rel = path.relative(extractedDir, path.dirname(plugin));
    pluginDirs.add(rel === '.' ? '' : rel);
  }
  return [...pluginDirs];
};

const inferPackagesFromExtracted = (
  extractedDir: string,
  primaryPluginPath?: string,
): ImportPackPackage[] => {
  if (primaryPluginPath) {
    const pluginPath = path.resolve(primaryPluginPath);
    const folder = path.relative(extractedDir, path.dirname(pluginPath));
    const normalizedFolder = folder === '.' ? '' : folder.replace(/\\/g, '/');
    const packageDir = path.dirname(pluginPath);
    return [
      {
        folder: normalizedFolder,
        pluginFiles: [path.relative(packageDir, pluginPath).replace(/\\/g, '/')],
        archives: [],
      },
    ];
  }

  const folders = listTopLevelPackageFolders(extractedDir);
  if (folders.length === 0) {
    return [
      {
        folder: '',
        pluginFiles: discoverModFiles(extractedDir).plugins.map((p) =>
          path.relative(extractedDir, p).replace(/\\/g, '/'),
        ),
        archives: [],
      },
    ];
  }

  return folders.map((folder) => {
    const packageDir = folder ? path.join(extractedDir, folder) : extractedDir;
    return {
      folder,
      pluginFiles: discoverModFiles(packageDir).plugins.map((p) =>
        path.relative(packageDir, p).replace(/\\/g, '/'),
      ),
      archives: [],
    };
  });
};

const deriveModName = (extractDir: string, modName?: string): string => {
  if (modName?.trim()) return modName.trim();
  const importManifest = readModImportExtractManifest(extractDir);
  const containerName = importManifest?.container?.fileName;
  if (containerName) {
    return containerName.replace(/\.(zip|7z|rar)$/i, '');
  }
  const base = path.basename(extractDir);
  return base.startsWith('_extracted_') ? 'mod' : base;
};

/**
 * Pack an import extract tree into .7z archives under `_output/{extractName}/`.
 * Rebuilds BA2/BSA from loose files (import manifest or inferred layout) before creating 7z.
 */
export const packModImport = async (
  options: PackModImportOptions,
): Promise<PackModImportResult> => {
  const extractedDir = path.resolve(options.extractDir);
  const outputDir = path.resolve(options.outputDir ?? modImportPackOutputDir(extractedDir));

  if (!fs.existsSync(extractedDir)) {
    throw new Error(`Import extract directory not found: ${extractedDir}`);
  }

  const modName = deriveModName(extractedDir, options.modName);
  const game = options.game ?? 'fo4';
  const packages = inferPackagesFromExtracted(extractedDir, options.pluginPath);

  ensureDir(outputDir);
  const stagingRoot = path.join(outputDir, '.pack-staging');
  removeDirectory(stagingRoot);
  ensureDir(stagingRoot);

  const createdArchives: string[] = [];
  const bethesdaArchives: string[] = [];
  const multiPackage = packages.length > 1;

  try {
    for (const pkg of packages) {
      const { stagingDir, bethesdaArchives: packedBa } = buildPackageStagingDir(
        extractedDir,
        pkg,
        stagingRoot,
        game,
      );
      bethesdaArchives.push(...packedBa);

      const archiveBase = resolvePackageArchiveName(pkg);
      const archiveName = multiPackage ? `${archiveBase}.7z` : `${modName}.7z`;
      const archivePath = path.join(outputDir, archiveName);

      log.info(`Packing ${pkg.folder || '(root)'} → ${archiveName}`);
      await create7zArchive(stagingDir, archivePath);
      createdArchives.push(archivePath);
      removeDirectory(stagingDir);
    }
  } finally {
    removeDirectory(stagingRoot);
  }

  return {
    modName,
    outputDir,
    archives: createdArchives,
    bethesdaArchives,
  };
};
