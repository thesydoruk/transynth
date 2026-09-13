import fs from 'node:fs';
import path from 'node:path';
import { filterPrimaryPlugins } from '../import/mod/importAnchor';
import { discoverModFiles, isPlugin } from '../import/mod/discovery';
import { parseVortexModFolder } from '../utils/vortexFolder';
import { collectPluginUnitFiles } from './collectSubset';
import { merkleContentHash } from './hashSubset';
import { hasVortexImportAnchor } from './syncWorthy';
import type { VortexInventoryUnit } from './types';

const SKIP_TOP_NAMES = new Set(['.git', 'node_modules', '.transynth-extracted']);

const unitIdFor = (folderName: string, pluginFileName: string | null): string => {
  const stem = pluginFileName
    ? path.basename(pluginFileName, path.extname(pluginFileName))
    : 'folder';
  return `mods:${folderName}:${stem}`.toLowerCase();
};

export const scanStagingUnits = async (stagingPath: string): Promise<VortexInventoryUnit[]> => {
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
    const vortex = parseVortexModFolder(entry.name);
    const discovered = discoverModFiles(folderPath);
    const primary = filterPrimaryPlugins(discovered.plugins);
    const pluginTargets = primary.length > 0 ? primary : [null];

    for (const pluginPath of pluginTargets) {
      const files = collectPluginUnitFiles(folderPath, pluginPath);
      if (files.length === 0) continue;
      if (!hasVortexImportAnchor(files.map((file) => file.relPath))) continue;
      const pluginFileName = pluginPath ? path.basename(pluginPath) : null;
      const pluginStem = pluginFileName
        ? path.basename(pluginFileName, path.extname(pluginFileName))
        : null;
      const name = vortex?.modName || pluginStem || entry.name;
      const contentHash = await merkleContentHash(files);
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
