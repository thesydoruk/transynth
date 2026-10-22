import fs from 'node:fs';
import path from 'node:path';

export type DiscoveredGameAssets = {
  root: string;
  source: 'env' | 'creation-kit';
  fonixDataPath: string;
};

export type DiscoverVoiceAssetsOptions = {
  /** When true, only scan explicit `extraRoots` (used in unit tests). */
  rootsOnly?: boolean;
};

/** Where a game or Creation Kit install keeps the Fonix phoneme data. */
const FONIX_REL_PATHS = [
  'Data/Sound/Voice/Processing/FonixData.cdf',
  'Sound/Voice/Processing/FonixData.cdf',
] as const;

/** Install roots the environment may point at (a game or Creation Kit copy on this box). */
const ENV_ROOT_KEYS = [
  'CREATION_KIT_DIR',
  'CK_DIR',
  'FO4_CK_DIR',
  'SKYRIMSE_CK_DIR',
  'FO4_DIR',
  'FALLOUT4_DIR',
  'SKYRIMSE_DIR',
  'GAME_DIR',
] as const;

const firstExisting = (root: string, relPaths: readonly string[]): string | undefined => {
  for (const rel of relPaths) {
    const full = path.join(root, ...rel.split('/'));
    if (fs.existsSync(full)) return full;
  }
  return undefined;
};

type RootCandidate = { root: string; source: DiscoveredGameAssets['source'] };

/** Collect game / Creation Kit roots from explicit paths and the environment. */
export const collectVoiceAssetRoots = (
  extraRoots: string[] = [],
  options: DiscoverVoiceAssetsOptions = {},
): RootCandidate[] => {
  const seen = new Set<string>();
  const candidates: RootCandidate[] = [];

  const add = (root: string, source: RootCandidate['source']): void => {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved) || seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push({ root: resolved, source });
  };

  for (const root of extraRoots) {
    if (root.trim()) add(root, 'env');
  }

  if (options.rootsOnly) return candidates;

  for (const key of ENV_ROOT_KEYS) {
    const value = process.env[key]?.trim();
    if (value)
      add(value, key.includes('CK') || key === 'CREATION_KIT_DIR' ? 'creation-kit' : 'env');
  }

  return candidates;
};

/** Every root that holds `FonixData.cdf`, in the order the roots were given. */
export const discoverGameVoiceAssets = (
  extraRoots: string[] = [],
  options: DiscoverVoiceAssetsOptions = {},
): DiscoveredGameAssets[] => {
  const results: DiscoveredGameAssets[] = [];
  for (const { root, source } of collectVoiceAssetRoots(extraRoots, options)) {
    const fonixDataPath = firstExisting(root, FONIX_REL_PATHS);
    if (fonixDataPath) results.push({ root, source, fonixDataPath });
  }
  return results;
};

export const pickFirstGameAsset = (
  discoveries: DiscoveredGameAssets[],
): { fonixDataPath?: string; root?: string } => {
  const first = discoveries[0];
  return first ? { fonixDataPath: first.fonixDataPath, root: first.root } : {};
};
