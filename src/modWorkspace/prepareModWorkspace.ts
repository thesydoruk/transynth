import fs from 'node:fs';
import path from 'node:path';
import { isBa2GnrArchive } from '../formats/ba2/readBa2ArchiveType';
import { BsaReader } from '../formats/bsa';
import { log } from '../logger';
import type { GameType } from '../types';
import { copyFileSafe, ensureDir } from '../utils/file';
import { discoverModFiles, extractArchive, isArchive } from '../web/import/modImportService';
import {
  extractAllBethesdaArchivesInTree,
  extractBa2ToDir,
  extractBsaToDir,
  listBa2ArchiveEntries,
} from './extractBethesdaArchives';
import {
  type ArchiveManifestEntry,
  type ModWorkspaceManifest,
  type ModWorkspacePackage,
  writeModWorkspaceManifest,
} from './archiveManifest';

const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);
const INVALID_DIR_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export type PrepareModWorkspaceOptions = {
  modPath: string;
  workingDir: string;
  modName?: string;
  game?: GameType;
  force?: boolean;
};

export type PrepareModWorkspaceResult = {
  modName: string;
  workspaceDir: string;
  sourceDir: string;
  extractedDir: string;
  outputDir: string;
  pluginCount: number;
};

/** Sanitize a folder name for Windows and POSIX filesystems. */
export const sanitizeDirName = (name: string): string => {
  const trimmed = name.trim().replace(INVALID_DIR_CHARS, '_').replace(/\.+$/, '');
  return trimmed.length > 0 ? trimmed : 'mod';
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

const resolveModName = (modPath: string, override?: string): string => {
  if (override?.trim()) return sanitizeDirName(override);
  const base = path.basename(modPath);
  if (isArchive(base)) return sanitizeDirName(base.slice(0, -path.extname(base).length));
  return sanitizeDirName(base);
};

const copyModToSource = (modPath: string, sourceDir: string): void => {
  const stat = fs.statSync(modPath);
  ensureDir(sourceDir);
  if (stat.isDirectory()) {
    copyDirectory(modPath, sourceDir);
    return;
  }
  copyFileSafe(modPath, path.join(sourceDir, path.basename(modPath)));
};

const populateExtractedFromSource = async (
  sourceDir: string,
  extractedDir: string,
): Promise<void> => {
  ensureDir(extractedDir);
  const entries = fs.readdirSync(sourceDir);
  if (entries.length === 1 && isArchive(entries[0]!)) {
    await extractArchive(path.join(sourceDir, entries[0]!), extractedDir);
    return;
  }
  copyDirectory(sourceDir, extractedDir);
};

const listPluginsRecursive = (dir: string): string[] => discoverModFiles(dir).plugins;

const discoverArchiveCandidatesForPlugin = (espPath: string): string[] => {
  const pluginDir = path.dirname(espPath);
  const fromPluginDir = discoverModFiles(pluginDir);
  const candidates = [...fromPluginDir.ba2s, ...fromPluginDir.bsas];
  if (candidates.length > 0) return candidates;

  const parentDir = path.dirname(pluginDir);
  if (parentDir === pluginDir) return candidates;

  const fromParent = discoverModFiles(parentDir);
  return [...fromParent.ba2s, ...fromParent.bsas];
};

const listCompanionGnrlBa2ForPlugin = (
  espPath: string,
  game: GameType,
  ba2Candidates: string[],
): string[] => {
  const modDir = path.dirname(espPath);
  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  const baseStem = path.basename(espPath, path.extname(espPath));
  const suffixes =
    game === 'fo4' || game === 'fo76' ? [' - main', ' - interface', ''] : [' - main', ''];
  const matched = new Set<string>();

  for (const suffix of suffixes) {
    const target = suffix ? `${stem}${suffix}` : stem;
    for (const ba2 of ba2Candidates) {
      if (path.basename(ba2, '.ba2').toLowerCase() === target) matched.add(ba2);
    }
    const candidate = suffix ? `${baseStem}${suffix}.ba2` : `${baseStem}.ba2`;
    const p = path.join(modDir, candidate);
    if (fs.existsSync(p) && isBa2GnrArchive(p)) matched.add(p);
  }

  for (const ba2 of ba2Candidates.filter((f) => isBa2GnrArchive(f))) {
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (base.startsWith(stem)) matched.add(ba2);
  }

  return [...matched];
};

const listCompanionBsaForPlugin = (espPath: string, bsaCandidates: string[]): string[] => {
  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  const baseStem = path.basename(espPath, path.extname(espPath));
  const variants = [`${stem} - strings`, `${stem} - textures`, stem];
  const matched = new Set<string>();

  for (const variant of variants) {
    for (const bsa of bsaCandidates) {
      if (path.basename(bsa, '.bsa').toLowerCase() === variant) matched.add(bsa);
    }
    const p = path.join(path.dirname(espPath), `${baseStem}.bsa`);
    if (fs.existsSync(p)) matched.add(p);
    const pStrings = path.join(path.dirname(espPath), `${baseStem} - strings.bsa`);
    if (fs.existsSync(pStrings)) matched.add(pStrings);
    const pTextures = path.join(path.dirname(espPath), `${baseStem} - textures.bsa`);
    if (fs.existsSync(pTextures)) matched.add(pTextures);
  }

  for (const bsa of bsaCandidates) {
    const base = path.basename(bsa, '.bsa').toLowerCase();
    if (base.startsWith(stem)) matched.add(bsa);
  }

  return [...matched];
};

const copyLooseStringsForPlugin = (espPath: string, destDir: string): void => {
  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  const espDir = path.dirname(espPath);
  for (const stringsDirName of ['Strings', 'strings']) {
    const stringsDir = path.join(espDir, stringsDirName);
    if (!fs.existsSync(stringsDir) || !fs.statSync(stringsDir).isDirectory()) continue;
    for (const file of fs.readdirSync(stringsDir)) {
      if (!file.toLowerCase().startsWith(stem)) continue;
      copyFileSafe(path.join(stringsDir, file), path.join(destDir, stringsDirName, file));
    }
  }
};

const copyLooseSiblingFiles = (espPath: string, destDir: string, allPlugins: string[]): void => {
  const espDir = path.dirname(espPath);
  const otherPlugins = new Set(
    allPlugins.filter((p) => p !== espPath).map((p) => path.basename(p)),
  );

  for (const entry of fs.readdirSync(espDir, { withFileTypes: true })) {
    const full = path.join(espDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'Strings' || entry.name === 'strings') continue;
      copyDirectory(full, path.join(destDir, entry.name));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (PLUGIN_EXTS.has(ext) && otherPlugins.has(entry.name)) continue;
    if (ext === '.ba2' || ext === '.bsa' || ext === '.zip' || ext === '.7z' || ext === '.rar')
      continue;
    copyFileSafe(full, path.join(destDir, entry.name));
  }
};

const extractCompanionArchives = (
  archives: string[],
  pluginOut: string,
): ArchiveManifestEntry[] => {
  const manifest: ArchiveManifestEntry[] = [];
  for (const archivePath of archives) {
    const destArch = path.join(pluginOut, path.basename(archivePath));
    copyFileSafe(archivePath, destArch);
    const ext = path.extname(destArch).toLowerCase();
    if (ext === '.ba2') {
      manifest.push({
        type: 'ba2',
        fileName: path.basename(destArch),
        entries: listBa2ArchiveEntries(destArch),
      });
      extractBa2ToDir(destArch, pluginOut);
    } else if (ext === '.bsa') {
      const reader = new BsaReader(destArch);
      const entries = reader.list().map((entry) => entry.name);
      manifest.push({
        type: 'bsa',
        fileName: path.basename(destArch),
        entries,
        bsaVersion: reader.version,
      });
      extractBsaToDir(destArch, pluginOut);
    }
    fs.unlinkSync(destArch);
  }
  return manifest;
};

const buildPerPluginExtractedTree = (
  stagingDir: string,
  extractedDir: string,
  plugins: string[],
  game: GameType,
): ModWorkspacePackage[] => {
  const usedNames = new Map<string, number>();
  const packages: ModWorkspacePackage[] = [];

  const uniqueFolderName = (stem: string): string => {
    const base = sanitizeDirName(stem);
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  };

  for (const espPath of plugins) {
    const stem = path.basename(espPath, path.extname(espPath));
    const folderName = uniqueFolderName(stem);
    const pluginOut = path.join(extractedDir, folderName);
    ensureDir(pluginOut);

    const pluginFileName = path.basename(espPath);
    copyFileSafe(espPath, path.join(pluginOut, pluginFileName));

    const archiveCandidates = discoverArchiveCandidatesForPlugin(espPath);
    const ba2s = archiveCandidates.filter((f) => f.toLowerCase().endsWith('.ba2'));
    const bsas = archiveCandidates.filter((f) => f.toLowerCase().endsWith('.bsa'));
    const companions = [
      ...listCompanionGnrlBa2ForPlugin(espPath, game, ba2s),
      ...listCompanionBsaForPlugin(espPath, bsas),
    ];

    const archives = extractCompanionArchives(companions, pluginOut);
    copyLooseStringsForPlugin(espPath, pluginOut);
    copyLooseSiblingFiles(espPath, pluginOut, plugins);

    packages.push({
      folder: folderName,
      pluginFiles: [pluginFileName],
      archives,
    });

    log.info(
      `  ${stem}: ${path.relative(extractedDir, pluginOut)} (${companions.length} archive(s))`,
    );
  }

  return packages;
};

/**
 * Create a per-mod workspace with a pristine `source/` copy and a fully unpacked `extracted/` tree.
 */
export const prepareModWorkspace = async (
  options: PrepareModWorkspaceOptions,
): Promise<PrepareModWorkspaceResult> => {
  const modPath = path.resolve(options.modPath);
  if (!fs.existsSync(modPath)) {
    throw new Error(`Mod path not found: ${modPath}`);
  }

  const workingDir = path.resolve(options.workingDir);
  const modName = resolveModName(modPath, options.modName);
  const game = options.game ?? 'fo4';
  const workspaceDir = path.join(workingDir, modName);
  const sourceDir = path.join(workspaceDir, 'source');
  const extractedDir = path.join(workspaceDir, 'extracted');

  if (fs.existsSync(workspaceDir)) {
    if (!options.force) {
      throw new Error(
        `Workspace already exists: ${workspaceDir} (pass force=true or --force to overwrite)`,
      );
    }
    removeDirectory(workspaceDir);
  }

  ensureDir(workspaceDir);
  log.info(`Preparing workspace for "${modName}" at ${workspaceDir}`);

  copyModToSource(modPath, sourceDir);
  await populateExtractedFromSource(sourceDir, extractedDir);

  const plugins = listPluginsRecursive(extractedDir);
  let packages: ModWorkspacePackage[];

  if (plugins.length > 1) {
    log.info(`Found ${plugins.length} plugins — creating per-plugin subfolders`);
    const stagingDir = path.join(workspaceDir, '.extract-staging');
    removeDirectory(stagingDir);
    fs.renameSync(extractedDir, stagingDir);
    ensureDir(extractedDir);
    packages = buildPerPluginExtractedTree(stagingDir, extractedDir, plugins, game);
    removeDirectory(stagingDir);
  } else {
    const archives = extractAllBethesdaArchivesInTree(extractedDir);
    packages = [
      {
        folder: '',
        pluginFiles: plugins.map((p) => path.relative(extractedDir, p).replace(/\\/g, '/')),
        archives,
      },
    ];
    if (plugins.length === 1) {
      log.info(`Single plugin: ${path.basename(plugins[0]!)}`);
    } else {
      log.warn('No ESP/ESM/ESL plugins found — extracted archives and loose files only');
    }
  }

  const manifest: ModWorkspaceManifest = {
    version: 1,
    game,
    modName,
    packages,
  };
  writeModWorkspaceManifest(workspaceDir, manifest);

  return {
    modName,
    workspaceDir,
    sourceDir,
    extractedDir,
    outputDir: path.join(workspaceDir, 'output'),
    pluginCount: plugins.length,
  };
};
