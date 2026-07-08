import fs from 'node:fs';
import path from 'node:path';

export type GameVoiceAssets = {
  root: string;
  fonixData: string | null;
  xWmaEncode: string | null;
};

const existsFile = (filePath: string): string | null => (fs.existsSync(filePath) ? filePath : null);

const fonixCandidates = (root: string): string[] => [
  path.join(root, 'Data', 'Sound', 'Voice', 'Processing', 'FonixData.cdf'),
  path.join(root, 'Sound', 'Voice', 'Processing', 'FonixData.cdf'),
];

const xWmaCandidates = (root: string): string[] => [
  path.join(root, 'Tools', 'Audio', 'xWMAEncode.exe'),
  path.join(root, 'Tools', 'Audio', 'xwmaencode.exe'),
  path.join(root, 'Tools', 'Audio', 'CommandLine', 'xWMAEncode.exe'),
];

const findFirstExisting = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    const hit = existsFile(candidate);
    if (hit) return hit;
  }
  return null;
};

/** Collect candidate game / Creation Kit roots from env and common install paths. */
export const collectGameInstallRoots = (extraRoots: string[] = []): string[] => {
  const roots = new Set<string>();

  for (const value of extraRoots) {
    const trimmed = value.trim();
    if (trimmed) roots.add(path.resolve(trimmed));
  }

  for (const envKey of [
    'FO4_DIR',
    'FALLOUT4_DIR',
    'SKYRIMSE_DIR',
    'SKYRIM_SE_DIR',
    'GAME_DIR',
    'STEAM_GAME_DIR',
  ]) {
    const envValue = process.env[envKey]?.trim();
    if (envValue) roots.add(path.resolve(envValue));
  }

  if (process.platform === 'win32') {
    const drives = ['C', 'D', 'E', 'F'];
    const steamGames = ['Fallout 4', 'Skyrim Special Edition', 'Fallout New Vegas', 'Fallout 3'];
    for (const drive of drives) {
      for (const game of steamGames) {
        roots.add(`${drive}:\\Program Files (x86)\\Steam\\steamapps\\common\\${game}`);
        roots.add(`${drive}:\\Steam\\steamapps\\common\\${game}`);
        roots.add(`${drive}:\\SteamLibrary\\steamapps\\common\\${game}`);
      }
    }
  }

  return [...roots];
};

/** Scan known game / CK directories for FonixData.cdf and xWMAEncode.exe. */
export const discoverGameVoiceAssets = (extraRoots: string[] = []): GameVoiceAssets[] => {
  const found: GameVoiceAssets[] = [];
  for (const root of collectGameInstallRoots(extraRoots)) {
    if (!fs.existsSync(root)) continue;
    const fonixData = findFirstExisting(fonixCandidates(root));
    const xWmaEncode = findFirstExisting(xWmaCandidates(root));
    if (!fonixData && !xWmaEncode) continue;
    found.push({ root, fonixData, xWmaEncode });
  }
  return found;
};

export const pickBestGameVoiceAssets = (
  extraRoots: string[] = [],
): { fonixData: string | null; xWmaEncode: string | null; sourceRoot: string | null } => {
  const candidates = discoverGameVoiceAssets(extraRoots);
  let fonixData: string | null = null;
  let xWmaEncode: string | null = null;
  let sourceRoot: string | null = null;

  for (const candidate of candidates) {
    if (!fonixData && candidate.fonixData) {
      fonixData = candidate.fonixData;
      sourceRoot = candidate.root;
    }
    if (!xWmaEncode && candidate.xWmaEncode) {
      xWmaEncode = candidate.xWmaEncode;
      sourceRoot = sourceRoot ?? candidate.root;
    }
    if (fonixData && xWmaEncode) break;
  }

  return { fonixData, xWmaEncode, sourceRoot };
};
