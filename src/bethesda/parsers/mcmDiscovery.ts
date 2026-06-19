/**
 * MCM Helper translation file discovery utilities.
 *
 * Standard layout:
 *   Interface/Translations/{modName}_{lang}.txt
 *
 * Some mods (e.g. FallUI) use custom paths and file stems:
 *   interface/FallUI Inventory/Translation/FallUIInv_en.txt
 *   MCM/Config/FallUI/Translation/MCM_FallUIInv_en.txt
 */
import fs from 'fs';
import path from 'path';
import { mcmLocaleFromPath } from './mcmTranslations';

const MCM_TXT_EXT = '.txt';

/** Bethesda / MCM Helper locale aliases (short file suffix → lookup keys). */
export const MCM_LOCALE_ALIASES = new Map<string, string[]>([
  ['en', ['en', 'english']],
  ['ru', ['ru', 'russian']],
  ['uk', ['uk', 'ukrainian']],
  ['cs', ['cs', 'czech']],
  ['de', ['de', 'german']],
  ['fr', ['fr', 'french']],
  ['es', ['es', 'spanish']],
  ['esmx', ['esmx', 'es', 'spanish']],
  ['it', ['it', 'italian']],
  ['pt', ['pt', 'portuguese']],
  ['ptbr', ['ptbr', 'pt', 'portuguese']],
  ['pl', ['pl', 'polish']],
  ['ja', ['ja', 'japanese']],
  ['zh', ['zh', 'cn', 'chinese']],
  ['cn', ['cn', 'zh', 'chinese']],
  ['ko', ['ko', 'korean']],
]);

const SKIP_DIRS = new Set(['.transynth-extracted', '.git', 'node_modules']);

type McmConfigJson = {
  modName?: string;
  pluginRequirements?: string[];
};

const isTranslationDirName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower === 'translations' || lower === 'translation';
};

/** Archive-relative path contains a Translation(s) folder. */
export const isMcmTranslationArchivePath = (archivePath: string): boolean => {
  const normalized = archivePath.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('/translation/') ||
    normalized.endsWith('/translation') ||
    normalized.includes('/translations/') ||
    normalized.endsWith('/translations')
  );
};

/**
 * File stem before the `_<locale>.txt` suffix, e.g. `FallUIInv_en.txt` → `FallUIInv`.
 */
export const mcmFileStemFromPath = (filePath: string): string | null => {
  const locale = mcmLocaleFromPath(filePath);
  if (!locale) return null;
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const suffix = `_${locale}.txt`;
  if (!base.toLowerCase().endsWith(suffix)) return null;
  return base.slice(0, base.length - suffix.length);
};

/**
 * Resolve the modName prefix used by MCM translation filenames.
 *
 * Prefers modName from a matching MCM/Config config.json, falling back
 * to the plugin file stem.
 */
export const resolveMcmModPrefix = (modDir: string, espPath: string): string => {
  const ext = path.extname(espPath).toLowerCase();
  const fileName = path.basename(espPath);
  const espStem =
    ext === MCM_TXT_EXT
      ? (mcmFileStemFromPath(fileName) ?? path.basename(espPath, ext))
      : path.basename(espPath, ext);
  const pluginName = fileName.toLowerCase();
  const configRoot = path.join(modDir, 'MCM', 'Config');

  if (fs.existsSync(configRoot)) {
    for (const entry of fs.readdirSync(configRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(configRoot, entry.name, 'config.json');
      if (!fs.existsSync(configPath)) continue;

      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as McmConfigJson;
        if (!config.modName) continue;

        const requirements = config.pluginRequirements ?? [];
        if (
          requirements.length === 0 ||
          requirements.some((req) => req.toLowerCase() === pluginName)
        ) {
          return config.modName;
        }
      } catch {
        // Ignore invalid config.json files.
      }
    }
  }

  return espStem;
};

/**
 * Resolve the mod root directory from a plugin path, translation txt, or folder.
 */
export const resolveModDirectoryFromPath = (filePath: string): string => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Path not found: ${filePath}`);
  }

  let dir = fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);

  for (let depth = 0; depth < 8; depth++) {
    if (
      fs.existsSync(path.join(dir, 'MCM', 'Config')) ||
      fs.existsSync(path.join(dir, 'Interface')) ||
      fs.existsSync(path.join(dir, 'interface')) ||
      fs.existsSync(path.join(dir, 'Data'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  dir = fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);
  while (isTranslationDirName(path.basename(dir))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
};

/** Collect MCM/Config subfolder Translation directories (not always under Interface). */
const collectMcmConfigTranslationDirs = (modDir: string): string[] => {
  const configRoot = path.join(modDir, 'MCM', 'Config');
  if (!fs.existsSync(configRoot)) return [];

  const dirs: string[] = [];
  for (const entry of fs.readdirSync(configRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const transDir = path.join(configRoot, entry.name, 'Translation');
    if (fs.existsSync(transDir)) dirs.push(transDir);
  }
  return dirs;
};

/** All directories that may contain MCM Helper translation txt files. */
export const listMcmTranslationDirs = (modDir: string): string[] => {
  const dirs = new Set<string>([
    ...findMcmTranslationDirs(modDir),
    ...collectMcmConfigTranslationDirs(modDir),
  ]);
  return [...dirs].sort();
};

/** True when the mod folder contains at least one MCM translation txt file. */
export const hasMcmTranslationFiles = (modDir: string): boolean => {
  return findFirstMcmTranslationFile(modDir) !== null;
};

/** First MCM translation txt file in a mod folder (stable sort order). */
export const findFirstMcmTranslationFile = (modDir: string): string | null => {
  for (const dir of listMcmTranslationDirs(modDir)) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const file of files.sort()) {
      if (!file.toLowerCase().endsWith(MCM_TXT_EXT)) continue;
      if (!mcmLocaleFromPath(file)) continue;
      return path.join(dir, file);
    }
  }
  return null;
};

/**
 * Collect file-name prefixes for MCM translation txt files in a mod folder.
 *
 * Includes the config modName plus any stems discovered next to MCM config
 * (FallUIInv, MCM_FallUIInv, …).
 */
export const resolveMcmTranslationPrefixes = (modDir: string, modPrefix: string): string[] => {
  const prefixes = new Set<string>([modPrefix]);
  const configRoot = path.join(modDir, 'MCM', 'Config');

  if (fs.existsSync(configRoot)) {
    for (const entry of fs.readdirSync(configRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const transDir = path.join(configRoot, entry.name, 'Translation');
      if (!fs.existsSync(transDir)) continue;
      collectPrefixesFromDir(transDir, prefixes);
    }
  }

  for (const dir of findMcmTranslationDirs(modDir)) {
    collectPrefixesFromDir(dir, prefixes);
  }

  return [...prefixes];
};

const collectPrefixesFromDir = (dir: string, prefixes: Set<string>): void => {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const file of files) {
    const stem = mcmFileStemFromPath(file);
    if (stem) prefixes.add(stem);
  }
};

/**
 * Find Translation/Translations directories under a mod tree.
 */
export const findMcmTranslationDirs = (modDir: string): string[] => {
  const dirs = new Set<string>();

  const addIfExists = (dir: string) => {
    if (fs.existsSync(dir)) dirs.add(dir);
  };

  addIfExists(path.join(modDir, 'Interface', 'Translations'));
  addIfExists(path.join(modDir, 'Interface', 'Translation'));
  addIfExists(path.join(modDir, 'interface', 'Translations'));
  addIfExists(path.join(modDir, 'interface', 'Translation'));
  addIfExists(path.join(modDir, 'Data', 'Interface', 'Translations'));
  addIfExists(path.join(modDir, 'Data', 'Interface', 'Translation'));

  const walk = (currentDir: string, depth: number) => {
    if (depth > 6) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (isTranslationDirName(entry.name)) dirs.add(fullPath);
      walk(fullPath, depth + 1);
    }
  };

  walk(modDir, 0);
  return [...dirs];
};

/** True when a translation filename matches any known MCM file prefix. */
export const mcmTranslationMatchesMod = (
  fileName: string,
  modPrefix: string | string[],
): boolean => {
  const stem = mcmFileStemFromPath(fileName);
  if (!stem) return false;

  const prefixes = Array.isArray(modPrefix) ? modPrefix : [modPrefix];
  const stemLower = stem.toLowerCase();
  return prefixes.some((prefix) => {
    const p = prefix.toLowerCase();
    if (stemLower === p) return true;
    if (stemLower.startsWith(`${p}_`)) return true;
    if (stemLower.startsWith(`mcm_${p}`)) return true;
    // FallUIInv_en.txt when modName is FallUI
    if (stemLower.startsWith(p) && stemLower.length > p.length) return true;
    return false;
  });
};

/**
 * Resolve a locale key present in an imported MCM locale map.
 *
 * Accepts short UI codes (en, zh) and long Bethesda names (english).
 */
export const resolveMcmLocaleKey = <T>(
  locales: Map<string, T>,
  requestedLang: string,
): { resolvedKey: string; value: T } | null => {
  const requested = requestedLang.trim().toLowerCase();
  if (!requested) return null;

  const candidates = MCM_LOCALE_ALIASES.get(requested) ?? [requested];
  for (const candidate of candidates) {
    const value = locales.get(candidate);
    if (value !== undefined) {
      return { resolvedKey: candidate, value };
    }
  }

  for (const [localeKey, aliasList] of MCM_LOCALE_ALIASES) {
    if (!aliasList.includes(requested)) continue;
    const value = locales.get(localeKey);
    if (value !== undefined) {
      return { resolvedKey: localeKey, value };
    }
  }

  return null;
};
