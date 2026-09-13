import path from 'node:path';
import type { GameType } from '../types';
import { resolveDirectoryInput } from '../utils/file';
import { vortexGroupKey } from './groupKey';
import { scanGameUnits } from './scanGame';
import { scanStagingUnits, stagingPluginBasenames } from './scanStaging';
import type { VortexChannel } from './stages';
import type { VortexInventory } from './types';

export const buildVortexInventory = async (opts: {
  game: GameType;
  stagingPath: string;
  gameDir: string;
  channel?: VortexChannel;
}): Promise<VortexInventory> => {
  const stagingPath = resolveDirectoryInput(opts.stagingPath);
  const gameDir = resolveDirectoryInput(opts.gameDir);
  const channel = opts.channel ?? 'all';

  const modUnits = channel === 'game' ? [] : await scanStagingUnits(stagingPath);
  const ownedPlugins = stagingPluginBasenames(modUnits);
  const gameScan =
    channel === 'mods'
      ? {
          units: [],
          gameRelease: { versionLabel: 'skipped', releaseHash: '' },
          dataDir: path.join(gameDir, 'Data'),
        }
      : await scanGameUnits(opts.game, gameDir, ownedPlugins);

  return {
    game: opts.game,
    stagingPath,
    gameDir,
    dataDir: gameScan.dataDir,
    groupKey: vortexGroupKey(opts.game, stagingPath),
    gameRelease: gameScan.gameRelease,
    units: [...gameScan.units, ...modUnits],
  };
};
