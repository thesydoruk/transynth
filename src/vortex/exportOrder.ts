import path from 'node:path';
import type { GameType } from '../types';
import { isPlugin } from '../import/mod/discovery';
import { discoverVortexDeployment } from './deploymentManifest';
import { discoverPluginLoadOrder } from './pluginsTxt';
import type { VortexExportOrder, VortexFileWinner } from './types';

export type VortexExportOrderDiscovery = VortexExportOrder & {
  loadOrderSource: string | null;
  deploymentSource: string | null;
};

export type VortexLangpackModRef = {
  id: number;
  name: string;
  channel: string | null;
  abs_path: string | null;
  source_folder: string | null;
  pluginFileName?: string | null;
};

export const isVortexExportOrder = (value: unknown): value is VortexExportOrder => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as {
    plugins?: unknown;
    fileWinners?: unknown;
    enabledPlugins?: unknown;
    applyOrder?: unknown;
  };
  if (!Array.isArray(rec.plugins) || !Array.isArray(rec.fileWinners)) return false;
  if (rec.enabledPlugins !== undefined) {
    if (
      !Array.isArray(rec.enabledPlugins) ||
      rec.enabledPlugins.some((name) => typeof name !== 'string')
    ) {
      return false;
    }
  }
  if (rec.applyOrder !== undefined && typeof rec.applyOrder !== 'boolean') return false;
  return (
    rec.plugins.every((name) => typeof name === 'string') &&
    rec.fileWinners.every((row) => {
      if (!row || typeof row !== 'object') return false;
      const item = row as { path?: unknown; sourceFolder?: unknown };
      return typeof item.path === 'string' && typeof item.sourceFolder === 'string';
    })
  );
};

export const discoverVortexExportOrder = (opts: {
  game: GameType;
  stagingPath: string;
  pluginsTxt?: string;
  vortexProfile?: string;
}): VortexExportOrderDiscovery => {
  const load = discoverPluginLoadOrder({
    game: opts.game,
    stagingPath: opts.stagingPath,
    pluginsTxt: opts.pluginsTxt,
    vortexProfile: opts.vortexProfile,
  });
  const deployment = discoverVortexDeployment(opts.stagingPath);
  const fileWinners: VortexFileWinner[] = (deployment?.files ?? []).map((file) => ({
    path: file.relPath,
    sourceFolder: file.sourceFolder,
  }));
  return {
    plugins: load.plugins,
    enabledPlugins: load.enabled,
    fileWinners,
    loadOrderSource: load.source,
    deploymentSource: deployment?.source ?? null,
  };
};

const pluginFromAbs = (absPath: string | null | undefined): string | null => {
  if (!absPath) return null;
  const base = path.basename(absPath);
  return isPlugin(base) ? base : null;
};

const pluginNameOf = (row: VortexLangpackModRef): string =>
  (row.pluginFileName || pluginFromAbs(row.abs_path) || '').toLowerCase();

/**
 * Langpack only ships mods Vortex currently has deployed. Plugin enable flags
 * in plugins.txt are ignored — a disabled ESP can still belong to an enabled mod.
 */
export const filterVortexLangpackMods = (
  rows: VortexLangpackModRef[],
  order: VortexExportOrder | null | undefined,
): VortexLangpackModRef[] => {
  if (!order) return rows;
  const deployedFolders = new Set(
    order.fileWinners.map((winner) => winner.sourceFolder.toLowerCase()),
  );
  if (deployedFolders.size === 0) return rows;

  return rows.filter((row) => {
    if (row.channel === 'game') return true;
    const folder = (row.source_folder || '').toLowerCase();
    return Boolean(folder && deployedFolders.has(folder));
  });
};

export const orderVortexLangpackModIds = (
  rows: VortexLangpackModRef[],
  order: VortexExportOrder | null | undefined,
): number[] => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ids = rows.map((row) => row.id);
  if (!order || (order.plugins.length === 0 && order.fileWinners.length === 0)) {
    return [...ids].sort((a, b) => {
      const left = byId.get(a)?.name ?? '';
      const right = byId.get(b)?.name ?? '';
      return left.localeCompare(right, 'en');
    });
  }

  const pluginRank = new Map(order.plugins.map((name, index) => [name.toLowerCase(), index]));
  const folderRank = new Map<string, number>();
  let nextFolder = 0;
  for (const winner of order.fileWinners) {
    const key = winner.sourceFolder.toLowerCase();
    if (!folderRank.has(key)) folderRank.set(key, nextFolder++);
  }

  const rank = (row: VortexLangpackModRef): [number, number, string] => {
    const plugin = pluginNameOf(row);
    if (plugin && pluginRank.has(plugin)) return [0, pluginRank.get(plugin)!, row.name];
    const folder = (row.source_folder || '').toLowerCase();
    if (folder && folderRank.has(folder)) return [1, folderRank.get(folder)!, row.name];
    return [row.channel === 'game' ? 2 : 3, 1_000_000, row.name];
  };

  return [...rows]
    .sort((a, b) => {
      const left = rank(a);
      const right = rank(b);
      if (left[0] !== right[0]) return left[0] - right[0];
      if (left[1] !== right[1]) return left[1] - right[1];
      return left[2].localeCompare(right[2], 'en');
    })
    .map((row) => row.id);
};
