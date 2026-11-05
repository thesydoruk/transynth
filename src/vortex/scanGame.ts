import fs from 'node:fs';
import path from 'node:path';
import type { GameId } from '../types';
import { sha1Hex } from '../utils/hash';
import { collectNamedPluginFiles } from './collectSubset';
import { discoverVortexDeployment } from './deploymentManifest';
import { merkleContentHash, type FileHasher } from './hashSubset';
import { readPeProductVersion } from './exeVersion';
import { exeNameForGame, isOfficialGamePlugin, officialMasterNames } from './gameProfiles';
import type { VortexGameReleaseHint, VortexInventoryFile, VortexInventoryUnit } from './types';

const resolveGameDataDir = (gameDir: string): string => {
  const direct = path.resolve(gameDir);
  if (
    fs.existsSync(path.join(direct, 'Fallout4.esm')) ||
    fs.existsSync(path.join(direct, 'Skyrim.esm'))
  ) {
    return direct;
  }
  const dataDir = path.join(direct, 'Data');
  if (fs.existsSync(dataDir)) return dataDir;
  return direct;
};

/**
 * Files Vortex deployed into Data belong to mods (our own langpack among them),
 * not to the game: hashing them would make the base game look changed, and
 * re-import it, every time a mod or the langpack is deployed.
 */
const withoutVortexDeployed = (
  dataDir: string,
  files: VortexInventoryFile[],
): VortexInventoryFile[] => {
  const deployed = discoverVortexDeployment(dataDir);
  if (!deployed) return files;
  const deployedPaths = new Set(deployed.files.map((file) => file.relPath.toLowerCase()));
  return files.filter((file) => !deployedPaths.has(file.relPath.replace(/\\/g, '/').toLowerCase()));
};

export const scanGameUnits = async (
  game: GameId,
  gameDir: string,
  stagingPluginNames: Set<string>,
  hashFile?: FileHasher,
): Promise<{
  units: VortexInventoryUnit[];
  gameRelease: VortexGameReleaseHint;
  dataDir: string;
}> => {
  const dataDir = resolveGameDataDir(gameDir);
  const rootDir = path.basename(dataDir).toLowerCase() === 'data' ? path.dirname(dataDir) : gameDir;

  let dataEntries: string[] = [];
  try {
    dataEntries = fs.readdirSync(dataDir);
  } catch (err) {
    throw new Error(
      `Cannot read game Data "${dataDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const candidates = new Set<string>();
  for (const name of officialMasterNames(game)) {
    if (!stagingPluginNames.has(name.toLowerCase())) candidates.add(name.toLowerCase());
  }
  for (const name of dataEntries) {
    if (isOfficialGamePlugin(game, name) && !stagingPluginNames.has(name.toLowerCase())) {
      candidates.add(name.toLowerCase());
    }
  }

  const units: VortexInventoryUnit[] = [];
  for (const lower of [...candidates].sort()) {
    const actual = dataEntries.find((name) => name.toLowerCase() === lower);
    if (!actual) continue;
    const files = withoutVortexDeployed(dataDir, collectNamedPluginFiles(dataDir, actual));
    if (files.length === 0) continue;
    const pluginStem = path.basename(actual, path.extname(actual));
    const contentHash = await merkleContentHash(files, hashFile);
    units.push({
      unitId: `game:${actual.toLowerCase()}`,
      channel: 'game',
      name: pluginStem,
      pluginStem,
      pluginFileName: actual,
      sourceFolder: null,
      nexusModId: null,
      nexusModName: null,
      contentHash,
      files,
    });
  }

  // The executable's product version is the most reliable release label; a
  // game with no known executable falls back to the content hash.
  const exeName = exeNameForGame(game);
  const exeVersion = exeName ? readPeProductVersion(path.join(rootDir, exeName)) : null;
  const versionLabel = exeVersion ?? units[0]?.contentHash.slice(0, 12) ?? 'unknown';
  const releaseHash = sha1Hex(units.map((unit) => `${unit.unitId}:${unit.contentHash}`).join('\n'));

  return { units, gameRelease: { versionLabel, releaseHash }, dataDir };
};
