import path from 'node:path';
import type { GameId } from '../types';
import { resolveDirectoryInput } from '../utils/file';
import { vortexGroupKey } from './groupKey';
import type { FileHasher } from './hashSubset';
import { scanGameUnits } from './scanGame';
import { scanStagingUnits, stagingPluginBasenames } from './scanStaging';
import type { VortexChannel } from './stages';
import type { VortexInventory } from './types';

export const buildVortexInventory = async (opts: {
  game: GameId;
  stagingPath: string;
  gameDir: string;
  channel?: VortexChannel;
  /** sha1 per file; the agent passes a size+mtime cache so archives hash once. */
  hashFile?: FileHasher;
  /** Count the cutscene videos (the game's and the mods') as part of their units. */
  videos?: boolean;
}): Promise<VortexInventory> => {
  const stagingPath = resolveDirectoryInput(opts.stagingPath);
  const gameDir = resolveDirectoryInput(opts.gameDir);
  const channel = opts.channel ?? 'all';
  const videos = opts.videos === true;

  const modUnits =
    channel === 'game' ? [] : await scanStagingUnits(stagingPath, opts.hashFile, { videos });
  const ownedPlugins = stagingPluginBasenames(modUnits);
  const gameScan =
    channel === 'mods'
      ? {
          units: [],
          gameRelease: { versionLabel: 'skipped', releaseHash: '' },
          dataDir: path.join(gameDir, 'Data'),
        }
      : await scanGameUnits(opts.game, gameDir, ownedPlugins, opts.hashFile, { videos });

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
