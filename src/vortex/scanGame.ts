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
import { isTransynthPackFolderName } from './scanStaging';
import { isVideoRelPath, VORTEX_BACKUP_SUFFIX } from './videoFiles';

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
 *
 * A video our own langpack deployed is the game's video with our dub in it:
 * the game's file, which Vortex keeps beside it as `<file>.vortex_backup`, is
 * what the unit lists, so the base game keeps its videos once they are dubbed.
 */
const withoutVortexDeployed = (
  dataDir: string,
  files: VortexInventoryFile[],
): VortexInventoryFile[] => {
  const deployed = discoverVortexDeployment(dataDir);
  if (!deployed) return files;
  const deployedBy = new Map(
    deployed.files.map((file) => [file.relPath.toLowerCase(), file.sourceFolder]),
  );
  const out: VortexInventoryFile[] = [];
  for (const file of files) {
    const owner = deployedBy.get(file.relPath.replace(/\\/g, '/').toLowerCase());
    if (owner == null) {
      out.push(file);
      continue;
    }
    if (!isVideoRelPath(file.relPath) || !isTransynthPackFolderName(owner)) continue;
    const backup = `${file.absPath}${VORTEX_BACKUP_SUFFIX}`;
    if (fs.existsSync(backup)) out.push({ absPath: backup, relPath: file.relPath });
  }
  return out;
};

export type ScanGameOptions = {
  /** Count the cutscene videos of the main master; off unless the agent dubs them. */
  videos?: boolean;
};

export const scanGameUnits = async (
  game: GameId,
  gameDir: string,
  stagingPluginNames: Set<string>,
  hashFile?: FileHasher,
  options: ScanGameOptions = {},
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

  const masters = officialMasterNames(game);
  const mainMaster = masters[0]?.toLowerCase() ?? null;
  const candidates = new Set<string>();
  for (const name of masters) {
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
    const files = withoutVortexDeployed(
      dataDir,
      collectNamedPluginFiles(dataDir, actual, {
        videos: options.videos === true && lower === mainMaster,
      }),
    );
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
