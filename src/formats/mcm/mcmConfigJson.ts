/**
 * MCM Helper config.json string extraction.
 *
 * Many mods (e.g. Workshop Framework) ship translatable MCM text inline in
 * MCM/Config/{ModName}/config.json instead of Interface/Translations/*.txt.
 * This module extracts those strings into MCM $key → text maps compatible with
 * the translation editor and apply matcher.
 */
import fs from 'fs';
import path from 'path';

type McmContentItem = {
  id?: string;
  text?: string;
  help?: string;
  type?: string;
  content?: McmContentItem[];
};

type McmPage = {
  pageDisplayName?: string;
  content?: McmContentItem[];
};

export type McmConfigJson = {
  modName?: string;
  displayName?: string;
  content?: McmContentItem[];
  pages?: McmPage[];
};

/** Default locale bucket for strings extracted from config.json source text. */
export const MCM_CONFIG_JSON_SOURCE_LOCALE = 'en';

const isTranslationReference = (value: string): boolean => value.startsWith('$');

/**
 * Register a translatable string from config.json.
 *
 * Inline text is stored under the generated key. Values that are already
 * `$placeholders` only add a stub entry when no inline text exists yet.
 */
const addMcmConfigString = (out: Map<string, string>, key: string, value: string): void => {
  const trimmed = value.trim();
  if (!trimmed) return;

  if (isTranslationReference(trimmed)) {
    if (!out.has(trimmed)) out.set(trimmed, trimmed);
    return;
  }

  if (!out.has(key)) out.set(key, value);
};

const walkContent = (
  out: Map<string, string>,
  items: McmContentItem[] | undefined,
  pageIndex: number | null,
): void => {
  if (!items) return;

  const scope = pageIndex === null ? 'Main' : `Page${pageIndex}`;
  let itemSeq = 0;

  for (const item of items) {
    itemSeq++;

    if (typeof item.text === 'string') {
      const key = item.id ? `$${item.id}` : `$${scope}_${item.type ?? 'item'}_${itemSeq}`;
      addMcmConfigString(out, key, item.text);
    }

    if (typeof item.help === 'string') {
      const key = item.id ? `$${item.id}_help` : `$${scope}_${item.type ?? 'item'}_${itemSeq}_help`;
      addMcmConfigString(out, key, item.help);
    }

    if (item.content?.length) {
      walkContent(out, item.content, pageIndex);
    }
  }
};

/**
 * Extract MCM translation keys and source text from a parsed config.json object.
 */
export const extractMcmStringsFromConfigJson = (config: unknown): Map<string, string> => {
  const out = new Map<string, string>();
  if (!config || typeof config !== 'object') return out;

  const root = config as McmConfigJson;

  if (typeof root.displayName === 'string') {
    addMcmConfigString(out, '$displayName', root.displayName);
  }

  walkContent(out, root.content, null);

  for (let pageIndex = 0; pageIndex < (root.pages?.length ?? 0); pageIndex++) {
    const page = root.pages![pageIndex]!;
    if (typeof page.pageDisplayName === 'string') {
      addMcmConfigString(out, `$Page${pageIndex}_DisplayName`, page.pageDisplayName);
    }
    walkContent(out, page.content, pageIndex);
  }

  return out;
};

/** List config.json files under MCM/Config subfolders in a mod directory. */
export const findMcmConfigJsonFiles = (modDir: string): string[] => {
  const configRoot = path.join(modDir, 'MCM', 'Config');
  if (!fs.existsSync(configRoot)) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(configRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(configRoot, entry.name, 'config.json');
    if (fs.existsSync(configPath)) files.push(configPath);
  }

  return files.sort();
};

/** True when a config.json belongs to the mod's MCM prefix list. */
export const mcmConfigJsonMatchesMod = (configPath: string, modPrefixes: string[]): boolean => {
  let config: McmConfigJson;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as McmConfigJson;
  } catch {
    return false;
  }

  const folder = path.basename(path.dirname(configPath));
  const candidates = [config.modName, folder].filter(Boolean) as string[];
  const normalizedPrefixes = modPrefixes.map((p) => p.toLowerCase());

  return candidates.some((name) => {
    const lower = name.toLowerCase();
    return normalizedPrefixes.some(
      (prefix) => lower === prefix || lower.startsWith(prefix) || prefix.startsWith(lower),
    );
  });
};

/**
 * Load inline MCM source strings from config.json files in a mod folder.
 *
 * Translation txt files take precedence when merged by callers.
 */
export const loadMcmLocalesFromConfigJson = (
  modDir: string,
  modPrefixes: string[],
): Map<string, Map<string, string>> => {
  const locales = new Map<string, Map<string, string>>();

  for (const configPath of findMcmConfigJsonFiles(modDir)) {
    if (!mcmConfigJsonMatchesMod(configPath, modPrefixes)) continue;

    let config: unknown;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      continue;
    }

    const strings = extractMcmStringsFromConfigJson(config);
    if (strings.size === 0) continue;

    if (!locales.has(MCM_CONFIG_JSON_SOURCE_LOCALE)) {
      locales.set(MCM_CONFIG_JSON_SOURCE_LOCALE, new Map());
    }
    const bucket = locales.get(MCM_CONFIG_JSON_SOURCE_LOCALE)!;
    for (const [key, text] of strings) {
      if (!bucket.has(key)) bucket.set(key, text);
    }
  }

  return locales;
};
