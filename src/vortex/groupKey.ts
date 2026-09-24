import path from 'node:path';

/** Stable group identity: game + normalized staging path. */
export const vortexGroupKey = (game: string, stagingPath: string): string => {
  const normalized = path
    .normalize(stagingPath.trim())
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return `${game}:${normalized}`;
};

export const scopedVortexFileHash = (groupId: number, contentHash: string): string =>
  `v${groupId}:${contentHash}`;

/**
 * Human label: Vortex staging folder, not the generic `mods` basename.
 * The path comes from the Windows client, so it is split with `path.win32`
 * (which accepts both separators) even when the server runs on Linux.
 */
export const vortexGroupLabel = (stagingPath: string, game: string): string => {
  const normalized = stagingPath.replace(/[\\/]+$/, '');
  const base = path.win32.basename(normalized);
  const parent = path.win32.basename(path.win32.dirname(normalized));
  const folder = base.toLowerCase() === 'mods' && parent ? parent : base || game;
  return `Vortex · ${folder}`;
};
