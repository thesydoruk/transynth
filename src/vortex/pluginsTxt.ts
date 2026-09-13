import fs from 'node:fs';
import path from 'node:path';
import type { GameType } from '../types';
import { officialMasterNames } from './officialPlugins';

const GAME_LOCAL_FOLDERS: Partial<Record<GameType, string>> = {
  fo4: 'Fallout4',
  fo76: 'Fallout76',
  fo3: 'Fallout3',
  fnv: 'FalloutNV',
  sse: 'Skyrim Special Edition',
  sle: 'Skyrim',
  ob: 'Oblivion',
  mw: 'Morrowind',
};

const GAME_VORTEX_IDS: Partial<Record<GameType, string>> = {
  fo4: 'fallout4',
  fo76: 'fallout76',
  fo3: 'fallout3',
  fnv: 'falloutnv',
  sse: 'skyrimse',
  sle: 'skyrim',
  ob: 'oblivion',
  mw: 'morrowind',
};

export type ParsedPluginList = {
  plugins: string[];
  enabled: string[];
};

const stripBom = (text: string): string => text.replace(/^\uFEFF/, '');

const isPluginLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  return /\.(esp|esm|esl)$/i.test(trimmed.replace(/^\*/, ''));
};

/** Parse Vortex/game `plugins.txt` (`*` = enabled) or `loadorder.txt` (order only). */
export const parsePluginList = (text: string): ParsedPluginList => {
  const plugins: string[] = [];
  const enabled: string[] = [];
  const seen = new Set<string>();
  for (const raw of stripBom(text).split(/\r?\n/)) {
    if (!isPluginLine(raw)) continue;
    const starred = raw.trim().startsWith('*');
    const name = raw.trim().replace(/^\*/, '').trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    plugins.push(name);
    if (starred) enabled.push(name);
  }
  return { plugins, enabled };
};

export const readPluginListFile = (filePath: string): ParsedPluginList => {
  if (!fs.existsSync(filePath)) return { plugins: [], enabled: [] };
  return parsePluginList(fs.readFileSync(filePath, 'utf8'));
};

export const gameLocalAppFolder = (game: GameType): string | undefined => GAME_LOCAL_FOLDERS[game];

export const vortexGameId = (game: GameType): string | undefined => GAME_VORTEX_IDS[game];

const newestChildDir = (dir: string): string | null => {
  if (!fs.existsSync(dir)) return null;
  const kids = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const abs = path.join(dir, entry.name);
      return { abs, mtime: fs.statSync(abs).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return kids[0]?.abs ?? null;
};

const mergePluginLists = (lists: ParsedPluginList[]): ParsedPluginList => {
  const plugins: string[] = [];
  const enabled: string[] = [];
  const seen = new Set<string>();
  const seenEnabled = new Set<string>();
  for (const list of lists) {
    for (const name of list.plugins) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      plugins.push(name);
    }
    for (const name of list.enabled) {
      const key = name.toLowerCase();
      if (seenEnabled.has(key)) continue;
      seenEnabled.add(key);
      enabled.push(name);
    }
  }
  return { plugins, enabled };
};

const readOrderPair = (dir: string): ParsedPluginList => {
  const loadorder = readPluginListFile(path.join(dir, 'loadorder.txt'));
  const plugins = readPluginListFile(path.join(dir, 'Plugins.txt'));
  const pluginsAlt = readPluginListFile(path.join(dir, 'plugins.txt'));
  return mergePluginLists([loadorder, plugins, pluginsAlt]);
};

const prependOfficialMasters = (game: GameType, list: ParsedPluginList): ParsedPluginList => {
  const masters = officialMasterNames(game);
  // Masters belong in load order; enabled is only plugins.txt `*` (plus deployed folders).
  const head: ParsedPluginList = { plugins: [...masters], enabled: [] };
  return mergePluginLists([head, list]);
};

export const discoverPluginLoadOrder = (opts: {
  game: GameType;
  stagingPath: string;
  pluginsTxt?: string;
  vortexProfile?: string;
}): ParsedPluginList & { source: string | null } => {
  const explicit = opts.pluginsTxt?.trim();
  if (explicit) {
    const stat = fs.existsSync(explicit) ? fs.statSync(explicit) : null;
    const dir = stat?.isDirectory() ? explicit : path.dirname(explicit);
    const file = stat?.isFile() ? readPluginListFile(explicit) : { plugins: [], enabled: [] };
    const merged = prependOfficialMasters(opts.game, mergePluginLists([file, readOrderPair(dir)]));
    return { ...merged, source: explicit };
  }

  const profile = opts.vortexProfile?.trim();
  if (profile && fs.existsSync(profile)) {
    const merged = prependOfficialMasters(opts.game, readOrderPair(profile));
    return { ...merged, source: profile };
  }

  const localFolder = gameLocalAppFolder(opts.game);
  const localDir =
    localFolder && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, localFolder)
      : null;
  if (localDir && fs.existsSync(localDir)) {
    const local = readOrderPair(localDir);
    if (local.plugins.length > 0) {
      return { ...prependOfficialMasters(opts.game, local), source: localDir };
    }
  }

  const profileRoots = [
    path.join(opts.stagingPath, '..', 'profiles'),
    process.env.APPDATA && vortexGameId(opts.game)
      ? path.join(process.env.APPDATA, 'Vortex', vortexGameId(opts.game)!, 'profiles')
      : null,
  ].filter((dir): dir is string => Boolean(dir));

  for (const root of profileRoots) {
    const newest = newestChildDir(root);
    if (!newest) continue;
    const list = readOrderPair(newest);
    if (list.plugins.length === 0) continue;
    return { ...prependOfficialMasters(opts.game, list), source: newest };
  }

  const fallback = prependOfficialMasters(opts.game, { plugins: [], enabled: [] });
  return { ...fallback, source: null };
};
