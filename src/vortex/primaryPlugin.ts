import path from 'node:path';

export type PluginWithMasters = { fileName: string; masters: string[] };

/** Case-insensitive, by code unit: the same order on every machine and locale. */
export const comparePluginNames = (a: string, b: string): number => {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
};

const EXTENSION_RANK: Record<string, number> = { '.esm': 0, '.esl': 1, '.esp': 2 };

/**
 * The plugin a Vortex folder is about, when it ships several: the one the
 * others build on (named as a master by the most of them), then a master file
 * over a plain plugin, then the shortest name, then alphabetical. For Sim
 * Settlements 2 that is `SS2.esm`, with the chapters and SS2Extended on top.
 * The folder's loose text (MCM, Interface, scripts) is imported into its mod.
 */
export const pickPrimaryPlugin = (plugins: readonly PluginWithMasters[]): string | null => {
  if (plugins.length === 0) return null;
  const dependents = (fileName: string): number => {
    const lower = fileName.toLowerCase();
    return plugins.filter(
      (other) =>
        other.fileName !== fileName && other.masters.some((m) => m.toLowerCase() === lower),
    ).length;
  };
  const rank = (fileName: string): number =>
    EXTENSION_RANK[path.extname(fileName).toLowerCase()] ?? 3;
  const stemLength = (fileName: string): number =>
    path.basename(fileName, path.extname(fileName)).length;

  const ranked = [...plugins].sort(
    (a, b) =>
      dependents(b.fileName) - dependents(a.fileName) ||
      rank(a.fileName) - rank(b.fileName) ||
      stemLength(a.fileName) - stemLength(b.fileName) ||
      comparePluginNames(a.fileName, b.fileName),
  );
  return ranked[0]!.fileName;
};
