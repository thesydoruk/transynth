/**
 * MCM Helper translation file discovery utilities.
 *
 * MCM mods ship Interface/Translations/{modName}_{lang}.txt files where
 * modName matches the modName field in MCM/Config/.../config.json.
 */
import fs from 'fs';
import path from 'path';

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

/**
 * Resolve the modName prefix used by MCM translation filenames.
 *
 * Prefers modName from a matching MCM/Config config.json, falling back
 * to the plugin file stem.
 */
export const resolveMcmModPrefix = (modDir: string, espPath: string): string => {
  const espStem = path.basename(espPath, path.extname(espPath));
  const pluginName = path.basename(espPath).toLowerCase();
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
 * Find every Interface/Translations directory under a mod tree.
 */
export const findMcmTranslationDirs = (modDir: string): string[] => {
  const dirs = new Set<string>();

  const addIfExists = (dir: string) => {
    if (fs.existsSync(dir)) dirs.add(dir);
  };

  addIfExists(path.join(modDir, 'Interface', 'Translations'));
  addIfExists(path.join(modDir, 'Data', 'Interface', 'Translations'));

  const walk = (currentDir: string, depth: number) => {
    if (depth > 4) return;

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      addIfExists(path.join(fullPath, 'Interface', 'Translations'));
      walk(fullPath, depth + 1);
    }
  };

  walk(modDir, 0);
  return [...dirs];
};

/** True when a translation filename belongs to the given MCM mod prefix. */
export const mcmTranslationMatchesMod = (fileName: string, modPrefix: string): boolean => {
  const lower = fileName.toLowerCase();
  const prefix = `${modPrefix.toLowerCase()}_`;
  return lower.startsWith(prefix) && lower.endsWith('.txt');
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
