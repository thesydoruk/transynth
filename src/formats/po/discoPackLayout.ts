/**
 * Disco Translator Final Cut language-pack discovery.
 *
 * Folders must look like `{Display}_{English}_{code}` (e.g. `English_English_en`,
 * `Ukrainian_Ukrainian_uk`) and contain one or more `.po` files.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Final Cut language folder: Display_English_code */
const LANG_DIR_RE = /^(.+)_([^_]+)_([a-zA-Z]{2,8})$/;

export type DiscoLangFolder = {
  /** Absolute path to the language folder */
  absPath: string;
  /** Folder basename, e.g. Ukrainian_Ukrainian_uk */
  folderName: string;
  /** Locale code from the folder suffix (lowercased), e.g. uk */
  locale: string;
  /** Display segment before the first underscore group */
  displayName: string;
  /** English name segment */
  englishName: string;
};

/** Parse a Final Cut language folder name, or null if it does not match. */
export const parseDiscoLangFolderName = (
  folderName: string,
): Omit<DiscoLangFolder, 'absPath'> | null => {
  const m = LANG_DIR_RE.exec(folderName);
  if (!m) return null;
  return {
    folderName,
    displayName: m[1]!,
    englishName: m[2]!,
    locale: m[3]!.toLowerCase(),
  };
};

/** Build a Final Cut folder name for a target locale (default Ukrainian). */
export const discoLangFolderNameForLocale = (locale: string): string => {
  const code = locale.toLowerCase();
  if (code === 'uk' || code === 'ua') return 'Ukrainian_Ukrainian_uk';
  if (code === 'en') return 'English_English_en';
  const label = code.toUpperCase();
  return `${label}_${label}_${code}`;
};

/** List `.po` files directly under a language folder (non-recursive). */
export const listPoFilesInDir = (dir: string): string[] => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.po'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b));
};

/** Recursively collect `.wav` files under a directory. */
export const listWavFilesRecursive = (dir: string): string[] => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.wav')) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
};

/**
 * Discover Final Cut language folders under `root` (one level + nested one level
 * for archives that wrap a single parent directory).
 */
export const discoverDiscoLangFolders = (root: string): DiscoLangFolder[] => {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  const found = new Map<string, DiscoLangFolder>();

  const consider = (dir: string, folderName: string) => {
    const parsed = parseDiscoLangFolderName(folderName);
    if (!parsed) return;
    if (listPoFilesInDir(dir).length === 0) return;
    found.set(path.resolve(dir), { absPath: dir, ...parsed });
  };

  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const child = path.join(root, ent.name);
    consider(child, ent.name);
    // One nested level: pack.zip → PackRoot/English_English_en/
    for (const nested of fs.readdirSync(child, { withFileTypes: true })) {
      if (!nested.isDirectory()) continue;
      consider(path.join(child, nested.name), nested.name);
    }
  }

  // Also accept root itself if it is already a language folder.
  consider(root, path.basename(root));

  return [...found.values()].sort((a, b) => a.locale.localeCompare(b.locale));
};

/** True when the extract tree looks like a Disco Final Cut language pack. */
export const hasDiscoPoPack = (root: string): boolean => discoverDiscoLangFolders(root).length > 0;

/** First `.po` file in the preferred (English) language folder, else any. */
export const findFirstDiscoPoFile = (root: string): string | null => {
  const folders = discoverDiscoLangFolders(root);
  if (folders.length === 0) return null;
  const preferred =
    folders.find((f) => f.locale === 'en') ??
    folders.find((f) => /english/i.test(f.folderName)) ??
    folders[0]!;
  const poFiles = listPoFilesInDir(preferred.absPath);
  return poFiles[0] ?? null;
};

/** Audio directory inside a language folder, if present. */
export const discoAudioDir = (langFolderAbs: string): string => path.join(langFolderAbs, 'Audio');
