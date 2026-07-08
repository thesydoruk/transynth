import fs from 'node:fs';
import path from 'node:path';

export type DiscoveredGameAssets = {
  root: string;
  source: 'env' | 'steam' | 'creation-kit' | 'game';
  fonixDataPath?: string;
  xWmaEncodePath?: string;
};

export type DiscoverVoiceAssetsOptions = {
  /** When true, only scan explicit `extraRoots` (used in unit tests). */
  rootsOnly?: boolean;
};

const FONIX_REL_PATHS = [
  'Data/Sound/Voice/Processing/FonixData.cdf',
  'Sound/Voice/Processing/FonixData.cdf',
] as const;

const XWMA_REL_PATHS = ['Tools/Audio/xWMAEncode.exe', 'Tools/Audio/xwmaencode.exe'] as const;

const CREATION_KIT_MARKERS = [
  'CreationKit.exe',
  'CreationKit64.exe',
  path.join('Tools', 'LipGen', 'LipGenBatch.bat'),
  path.join('Tools', 'LipGen', 'LipGenBatch.txt'),
] as const;

const KNOWN_GAME_FOLDERS = [
  'Fallout 4',
  'Fallout 4 Creation Kit',
  'Skyrim Special Edition',
  'Skyrim Special Edition Creation Kit',
  'Fallout New Vegas',
] as const;

/** Steam `common/` folders like `Fallout 4 1946160` (app id suffix). */
const STEAM_BETHESDA_FOLDER_PATTERNS = [
  /^Fallout 4( \d+)?$/i,
  /^Fallout 4 Creation Kit( \d+)?$/i,
  /^Skyrim Special Edition( \d+)?$/i,
  /^Skyrim Special Edition Creation Kit( \d+)?$/i,
  /^Fallout New Vegas( \d+)?$/i,
] as const;

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

const normalizeWindowsPath = (raw: string): string => raw.replace(/\\\\/g, '\\').trim();

const isCreationKitRoot = (root: string): boolean =>
  CREATION_KIT_MARKERS.some((marker) => fs.existsSync(path.join(root, marker)));

const matchesSteamBethesdaFolder = (folderName: string): boolean =>
  (KNOWN_GAME_FOLDERS as readonly string[]).includes(folderName) ||
  STEAM_BETHESDA_FOLDER_PATTERNS.some((pattern) => pattern.test(folderName));

const hasVoiceTooling = (root: string): boolean =>
  Boolean(firstExisting(root, FONIX_REL_PATHS) || firstExisting(root, XWMA_REL_PATHS));

/** Parse Steam `libraryfolders.vdf` and return library root paths. */
export const parseSteamLibraryPaths = (steamRoot?: string): string[] => {
  const libraries = new Set<string>();
  const steamCandidates = [
    steamRoot?.trim(),
    process.env.STEAM_DIR?.trim(),
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Steam' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files\\Steam' : undefined,
    process.platform === 'win32' ? 'D:\\SteamLibrary' : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const root of steamCandidates) {
    const resolved = path.resolve(root);
    libraries.add(resolved);

    const vdfPath = path.join(resolved, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(vdfPath)) continue;

    const text = fs.readFileSync(vdfPath, 'utf8');
    for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
      libraries.add(path.resolve(normalizeWindowsPath(match[1]!)));
    }
    for (const match of text.matchAll(/"\d+"\s+"([A-Za-z]:[^"]+)"/g)) {
      libraries.add(path.resolve(normalizeWindowsPath(match[1]!)));
    }
  }

  return [...libraries];
};

/** Scan Steam libraries for Creation Kit / Bethesda game installs. */
export const discoverCreationKitRoots = (steamRoot?: string): string[] => {
  const roots = new Set<string>();

  for (const library of parseSteamLibraryPaths(steamRoot)) {
    const commonDir = path.join(library, 'steamapps', 'common');
    if (!fs.existsSync(commonDir)) continue;

    for (const folder of KNOWN_GAME_FOLDERS) {
      const candidate = path.join(commonDir, folder);
      if (fs.existsSync(candidate)) roots.add(candidate);
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(commonDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!matchesSteamBethesdaFolder(entry.name)) continue;

      const candidate = path.join(commonDir, entry.name);
      if (isCreationKitRoot(candidate) || hasVoiceTooling(candidate)) {
        roots.add(candidate);
      }
    }
  }

  return [...roots];
};

type RootCandidate = { root: string; source: DiscoveredGameAssets['source'] };

/** Collect game / Creation Kit roots from env, Steam libraries, and explicit CLI paths. */
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

  for (const root of discoverCreationKitRoots()) {
    add(root, 'creation-kit');
  }

  if (process.platform === 'win32') {
    for (const drive of ['C', 'D', 'E', 'F']) {
      const steamCommon = `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common`;
      for (const folder of KNOWN_GAME_FOLDERS) {
        add(path.join(steamCommon, folder), 'game');
      }
      const altSteam = path.join(`${drive}:\\Steam`, 'steamapps', 'common');
      for (const folder of KNOWN_GAME_FOLDERS) {
        add(path.join(altSteam, folder), 'game');
      }
      add(path.join(`${drive}:\\SteamLibrary`, 'steamapps', 'common', 'Fallout 4'), 'game');
    }
  }

  return candidates;
};

/** @deprecated Use {@link collectVoiceAssetRoots}. */
export const collectGameInstallRoots = (extraRoots: string[] = []): string[] =>
  collectVoiceAssetRoots(extraRoots).map((item) => item.root);

export const discoverGameVoiceAssets = (
  extraRoots: string[] = [],
  options: DiscoverVoiceAssetsOptions = {},
): DiscoveredGameAssets[] => {
  const results: DiscoveredGameAssets[] = [];

  for (const { root, source } of collectVoiceAssetRoots(extraRoots, options)) {
    const fonixDataPath = firstExisting(root, FONIX_REL_PATHS);
    const xWmaEncodePath = firstExisting(root, XWMA_REL_PATHS);
    if (fonixDataPath || xWmaEncodePath) {
      results.push({ root, source, fonixDataPath, xWmaEncodePath });
    }
  }

  return results;
};

export const pickFirstGameAsset = (
  discoveries: DiscoveredGameAssets[],
): { fonixDataPath?: string; xWmaEncodePath?: string; root?: string } => {
  let fonixDataPath: string | undefined;
  let xWmaEncodePath: string | undefined;
  let fonixRoot: string | undefined;
  let xwmaRoot: string | undefined;

  const byPriority = [...discoveries].sort((left, right) => {
    const rank = (source: DiscoveredGameAssets['source']): number => {
      if (source === 'creation-kit' || source === 'env') return 0;
      if (source === 'steam') return 1;
      return 2;
    };
    return rank(left.source) - rank(right.source);
  });

  for (const item of byPriority) {
    if (!fonixDataPath && item.fonixDataPath) {
      fonixDataPath = item.fonixDataPath;
      fonixRoot = item.root;
    }
    if (!xWmaEncodePath && item.xWmaEncodePath) {
      xWmaEncodePath = item.xWmaEncodePath;
      xwmaRoot = item.root;
    }
    if (fonixDataPath && xWmaEncodePath) break;
  }

  return {
    fonixDataPath,
    xWmaEncodePath,
    root: fonixRoot ?? xwmaRoot,
  };
};
