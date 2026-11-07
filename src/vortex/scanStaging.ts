import fs from 'node:fs';
import path from 'node:path';
import { filterPrimaryPlugins } from '../import/mod/importAnchor';
import { discoverModFiles, isPlugin } from '../import/mod/discovery';
import { parseVortexModFolder } from '../utils/vortexFolder';
import { collectPluginUnitFiles } from './collectSubset';
import { merkleContentHash, type FileHasher } from './hashSubset';
import { hasVortexImportAnchor, type VortexSyncFileOptions } from './syncWorthy';
import type { VortexInventoryUnit } from './types';
import { isTransynthVideopackFolder } from './videoFiles';
import { UA_SOUND_PACK_ESP } from '../web/export/uaSoundPack';

const SKIP_TOP_NAMES = new Set(['.git', 'node_modules', '.transynth-extracted']);

/**
 * Transynth's own output, installed through Vortex — the langpack and the
 * videopack — is not a mod to translate: syncing it would upload gigabytes of
 * our voice archive or our dubbed videos and register a mod with nothing to
 * translate. Vortex names the mod after the archive we delivered; a renamed
 * langpack is still known by the dummy voice plugin.
 */
export const isTransynthOutputFolder = (folderPath: string, folderName: string): boolean =>
  /^transynth_.+_langpack_r\d+/i.test(folderName) ||
  isTransynthVideopackFolder(folderName) ||
  fs.existsSync(path.join(folderPath, UA_SOUND_PACK_ESP));

const unitIdFor = (folderName: string, pluginFileName: string | null): string => {
  const stem = pluginFileName
    ? path.basename(pluginFileName, path.extname(pluginFileName))
    : 'folder';
  return `mods:${folderName}:${stem}`.toLowerCase();
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
    const discovered = discoverModFiles(folderPath);
    const primary = filterPrimaryPlugins(discovered.plugins);
    const pluginTargets = primary.length > 0 ? primary : [null];

    for (const pluginPath of pluginTargets) {
      const files = collectPluginUnitFiles(folderPath, pluginPath, options);
      if (files.length === 0) continue;
      if (!hasVortexImportAnchor(files.map((file) => file.relPath))) continue;
      const pluginFileName = pluginPath ? path.basename(pluginPath) : null;
      const pluginStem = pluginFileName
        ? path.basename(pluginFileName, path.extname(pluginFileName))
        : null;
      const name = vortex?.modName || pluginStem || entry.name;
      const contentHash = await merkleContentHash(files, hashFile);
      units.push({
        unitId: unitIdFor(entry.name, pluginFileName),
        channel: 'mods',
        name,
        pluginStem,
        pluginFileName,
        sourceFolder: entry.name,
        nexusModId: vortex?.nexusModId ?? null,
        nexusModName: vortex?.modName ?? null,
        contentHash,
        files,
      });
    }
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
