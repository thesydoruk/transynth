import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import type { GameType } from '../types';
import { copyFileSafe, ensureDir } from '../utils/file';
import { discoverModFiles } from '../web/import/modImportService';
import {
  type ModWorkspaceManifest,
  type ModWorkspacePackage,
  readModWorkspaceManifest,
} from './archiveManifest';
import { isBethesdaArchiveFile, normalizeArchivePath } from './bethesdaArchivePaths';
import { create7zArchive } from './create7zArchive';
import {
  manifestArchivedPaths,
  packBethesdaArchivesIntoDir,
  resolvePackageArchives,
} from './packBethesdaArchives';

const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

export type PackModWorkspaceOptions = {
  workspaceDir: string;
  game?: GameType;
};

export type PackModWorkspaceResult = {
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

const resolvePackageArchiveName = (pkg: ModWorkspacePackage): string => {
  const plugin = pkg.pluginFiles[0];
  if (plugin) return path.basename(plugin, path.extname(plugin));
  if (pkg.folder) return path.basename(pkg.folder);
  return 'mod';
};

const buildPackageStagingDir = (
  extractedDir: string,
  pkg: ModWorkspacePackage,
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

const inferPackagesFromExtracted = (extractedDir: string): ModWorkspacePackage[] => {
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

/**
 * Pack `extracted/` into .7z archives under `output/`.
 * Rebuilds BA2/BSA from loose files (manifest or inferred layout) before creating 7z.
 */
export const packModWorkspace = async (
  options: PackModWorkspaceOptions,
): Promise<PackModWorkspaceResult> => {
  const workspaceDir = path.resolve(options.workspaceDir);
  const extractedDir = path.join(workspaceDir, 'extracted');
  const outputDir = path.join(workspaceDir, 'output');

  if (!fs.existsSync(extractedDir)) {
    throw new Error(`extracted/ not found in workspace: ${workspaceDir}`);
  }

  const manifest =
    readModWorkspaceManifest(workspaceDir) ??
    ({
      version: 1,
      game: options.game ?? 'fo4',
      modName: path.basename(workspaceDir),
      packages: inferPackagesFromExtracted(extractedDir),
    } satisfies ModWorkspaceManifest);

  const game = options.game ?? manifest.game;

  ensureDir(outputDir);
  const stagingRoot = path.join(workspaceDir, '.pack-staging');
  removeDirectory(stagingRoot);
  ensureDir(stagingRoot);

  const createdArchives: string[] = [];
  const bethesdaArchives: string[] = [];
  const multiPackage = manifest.packages.length > 1;

  try {
    for (const pkg of manifest.packages) {
      const { stagingDir, bethesdaArchives: packedBa } = buildPackageStagingDir(
        extractedDir,
        pkg,
        stagingRoot,
        game,
      );
      bethesdaArchives.push(...packedBa);

      const archiveBase = resolvePackageArchiveName(pkg);
      const archiveName = multiPackage ? `${archiveBase}.7z` : `${manifest.modName}.7z`;
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
    modName: manifest.modName,
    outputDir,
    archives: createdArchives,
    bethesdaArchives,
  };
};
