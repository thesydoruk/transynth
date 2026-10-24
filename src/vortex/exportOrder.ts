import path from 'node:path';
import type { GameId } from '../types';
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
  game: GameId;
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

/**
 * Stable topological pass: a row whose plugin lists another row's plugin as a
 * master moves after it, so a patch's own takes (written under its master's
 * voice folder) beat the master's. Every other relative order is kept. Cycles
 * cannot hang: a row still blocked once nothing is ready is emitted as-is.
 */
const applyMasterConstraint = (
  sorted: VortexLangpackModRef[],
  mastersOf: (row: VortexLangpackModRef) => string[],
  eligible: (row: VortexLangpackModRef) => boolean = () => true,
): VortexLangpackModRef[] => {
  const indexByPlugin = new Map<string, number>();
  sorted.forEach((row, index) => {
    const plugin = pluginNameOf(row);
    if (plugin && !indexByPlugin.has(plugin)) indexByPlugin.set(plugin, index);
  });
  if (indexByPlugin.size === 0) return sorted;

  const deps = sorted.map((row, index) => {
    if (!eligible(row)) return new Set<number>();
    const out = new Set<number>();
    for (const master of mastersOf(row)) {
      const dep = indexByPlugin.get(master.toLowerCase());
      if (dep != null && dep !== index) out.add(dep);
    }
    return out;
  });

  const emitted = new Array<boolean>(sorted.length).fill(false);
  const result: VortexLangpackModRef[] = [];
  while (result.length < sorted.length) {
    let pick = sorted.findIndex(
      (_row, index) => !emitted[index] && [...deps[index]!].every((dep) => emitted[dep]),
    );
    // Cycle: drop the blocking edges of the first remaining row.
    if (pick < 0) pick = emitted.indexOf(false);
    emitted[pick] = true;
    result.push(sorted[pick]!);
  }
  return result;
};

export const orderVortexLangpackModIds = (
  rows: VortexLangpackModRef[],
  order: VortexExportOrder | null | undefined,
  mastersOf?: (row: VortexLangpackModRef) => string[],
): number[] => {
  if (!order || (order.plugins.length === 0 && order.fileWinners.length === 0)) {
    const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return (mastersOf ? applyMasterConstraint(byName, mastersOf) : byName).map((row) => row.id);
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

  const ranked = [...rows].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    if (left[0] !== right[0]) return left[0] - right[0];
    if (left[1] !== right[1]) return left[1] - right[1];
    return left[2].localeCompare(right[2], 'en');
  });
  // Rows ranked by plugin load order are already correct; only the rest need the safety net.
  return (
    mastersOf ? applyMasterConstraint(ranked, mastersOf, (row) => rank(row)[0] !== 0) : ranked
  ).map((row) => row.id);
};
