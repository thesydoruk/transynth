import fs from 'node:fs';
import path from 'node:path';
import { filterPrimaryPlugins } from '../import/mod/importAnchor';
import { discoverModFiles, isPlugin } from '../import/mod/discovery';
import { parseVortexModFolder } from '../utils/vortexFolder';
import { readPluginMasterNames } from '../formats/esp';
import { collectFolderUnitFiles } from './collectSubset';
import { comparePluginNames, pickPrimaryPlugin } from './primaryPlugin';
import { merkleContentHash, type FileHasher } from './hashSubset';
import { hasVortexImportAnchor, type VortexSyncFileOptions } from './syncWorthy';
import type { VortexInventoryUnit } from './types';
import { isTransynthVideopackFolder } from './videoFiles';
import { UA_SOUND_PACK_ESP } from '../web/export/uaSoundPack';

const SKIP_TOP_NAMES = new Set(['.git', 'node_modules', '.transynth-extracted']);

/**
 * The staging folder of an archive we delivered, by the name Vortex gives the
 * mod: the langpack, or a videopack an older agent delivered before the dubbed
 * videos moved into the langpack.
 */
export const isTransynthPackFolderName = (folderName: string): boolean =>
  /^transynth_.+_langpack_r\d+/i.test(folderName) || isTransynthVideopackFolder(folderName);

/**
 * Transynth's own output, installed through Vortex, is not a mod to translate:
 * syncing it would upload gigabytes of our voice archive or our dubbed videos
 * and register a mod with nothing to translate. A renamed langpack is still
 * known by the dummy voice plugin.
 */
export const isTransynthOutputFolder = (folderPath: string, folderName: string): boolean =>
  isTransynthPackFolderName(folderName) || fs.existsSync(path.join(folderPath, UA_SOUND_PACK_ESP));

/** One unit per staging folder, whatever number of plugins it ships. */
const unitIdFor = (folderName: string): string => `mods:${folderName}`.toLowerCase();

const readMasters = (pluginPath: string): string[] => {
  try {
    return readPluginMasterNames(pluginPath);
  } catch {
    return [];
  }
};

export const scanStagingUnits = async (
  stagingPath: string,
  hashFile?: FileHasher,
  options: VortexSyncFileOptions = {},
): Promise<VortexInventoryUnit[]> => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stagingPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `Cannot read Vortex staging "${stagingPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const units: VortexInventoryUnit[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_TOP_NAMES.has(entry.name.toLowerCase())) continue;
    const folderPath = path.join(stagingPath, entry.name);
    if (isTransynthOutputFolder(folderPath, entry.name)) continue;
    const vortex = parseVortexModFolder(entry.name);
    const pluginPaths = filterPrimaryPlugins(discoverModFiles(folderPath).plugins);
    const plugins = pluginPaths.map((p) => path.basename(p)).sort(comparePluginNames);

    const files = collectFolderUnitFiles(folderPath, options);
    if (files.length === 0) continue;
    if (!hasVortexImportAnchor(files.map((file) => file.relPath))) continue;
    const pluginFileName = pickPrimaryPlugin(
      pluginPaths.map((p) => ({ fileName: path.basename(p), masters: readMasters(p) })),
    );
    const pluginStem = pluginFileName
      ? path.basename(pluginFileName, path.extname(pluginFileName))
      : null;
    units.push({
      unitId: unitIdFor(entry.name),
      channel: 'mods',
      name: vortex?.modName || pluginStem || entry.name,
      pluginStem,
      pluginFileName,
      ...(plugins.length > 1 ? { plugins } : {}),
      sourceFolder: entry.name,
      nexusModId: vortex?.nexusModId ?? null,
      nexusModName: vortex?.modName ?? null,
      contentHash: await merkleContentHash(files, hashFile),
      files,
    });
  }

  units.sort((a, b) => a.unitId.localeCompare(b.unitId, 'en'));
  return units;
};

export const stagingPluginBasenames = (units: VortexInventoryUnit[]): Set<string> => {
  const names = new Set<string>();
  for (const unit of units) {
    if (unit.pluginFileName) names.add(unit.pluginFileName.toLowerCase());
    for (const file of unit.files) {
      const base = path.basename(file.absPath);
      if (isPlugin(base)) names.add(base.toLowerCase());
    }
  }
  return names;
};
