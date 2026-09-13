import fs from 'node:fs';
import path from 'node:path';
import type { GameType } from '../types';
import { sha1Hex } from '../utils/hash';
import { collectNamedPluginFiles } from './collectSubset';
import { merkleContentHash } from './hashSubset';
import { readPeProductVersion } from './exeVersion';
import { isOfficialGamePlugin, officialMasterNames } from './officialPlugins';
import type { VortexGameReleaseHint, VortexInventoryUnit } from './types';

export const resolveGameDataDir = (gameDir: string): string => {
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

const exeNameForGame = (game: GameType): string => {
  if (game === 'fo4') return 'Fallout4.exe';
  if (game === 'fo76') return 'Fallout76.exe';
  if (game === 'fo3') return 'Fallout3.exe';
  if (game === 'fnv') return 'FalloutNV.exe';
  if (game === 'sse' || game === 'sle') return 'SkyrimSE.exe';
  return 'Fallout4.exe';
};

export const scanGameUnits = async (
  game: GameType,
  gameDir: string,
  stagingPluginNames: Set<string>,
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
    const files = collectNamedPluginFiles(dataDir, actual);
    if (files.length === 0) continue;
    const pluginStem = path.basename(actual, path.extname(actual));
    const contentHash = await merkleContentHash(files);
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

  const exePath = path.join(rootDir, exeNameForGame(game));
  const versionLabel =
    readPeProductVersion(exePath) ?? units[0]?.contentHash.slice(0, 12) ?? 'unknown';
  const releaseHash = sha1Hex(units.map((unit) => `${unit.unitId}:${unit.contentHash}`).join('\n'));

  return { units, gameRelease: { versionLabel, releaseHash }, dataDir };
};
