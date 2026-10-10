/**
 * Where The Witcher 3 keeps its text.
 *
 * Every text-bearing folder is a `content` directory holding one string table
 * per language, named by the game's own language code: `en.w3strings`,
 * `pl.w3strings`, … The same shape repeats at every level —
 *
 * - the game: `content/content0` … `content/content12`, `content/patch*`;
 * - the expansions and free DLC: `dlc/ep1/content`, `dlc/bob/content`, …;
 * - a mod: `mods/modFoo/content`, or a mod's own `dlc/dlcFoo/content`.
 *
 * so an upload, an unpacked mod and a whole game install are all read the same
 * way: find every `<lang>.w3strings`, group by the folder it sits in.
 */
import fs from 'node:fs';
import path from 'node:path';

/** `en.w3strings`, `esmx.w3strings` — the language code is the whole stem. */
const W3STRINGS_FILE_RE = /^([a-z]{2,4})\.w3strings$/i;
/** `enpc.w3speech` — voice, one container per language per content folder. */
const W3SPEECH_FILE_RE = /^([a-z]{2,4})pc\.w3speech$/i;

/** Folders that never hold game text and can be huge in an install. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'bin', 'bundles', 'scripts', 'cache']);

export type W3LanguageFile = {
  absPath: string;
  /** Game language code from the file name, lowercased: `en`, `pl`, `esmx`. */
  lang: string;
  /**
   * The containing folder relative to the scanned root, forward slashes —
   * `content/content0`, `mods/modFoo/content`. Empty for a file at the root.
   * This is the half of the record key that says which table a string is in.
   */
  contentDir: string;
};

const toPosix = (p: string): string => p.split(path.sep).join('/');

/** Parse a string-table file name, or null when it is not one. */
export const w3StringsLangFromFileName = (fileName: string): string | null => {
  const m = W3STRINGS_FILE_RE.exec(fileName);
  return m ? m[1]!.toLowerCase() : null;
};

/** Parse a voice container's file name to its language code, or null. */
export const w3SpeechLangFromFileName = (fileName: string): string | null => {
  const m = W3SPEECH_FILE_RE.exec(fileName);
  return m ? m[1]!.toLowerCase() : null;
};

/** Every file under `root` whose name `langOf` recognizes, sorted by folder then language. */
const listLanguageFiles = (
  root: string,
  langOf: (fileName: string) => string | null,
): W3LanguageFile[] => {
  const out: W3LanguageFile[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name.toLowerCase())) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const lang = langOf(entry.name);
      if (!lang) continue;
      out.push({ absPath: full, lang, contentDir: toPosix(path.relative(root, dir)) });
    }
  };
  walk(root);
  return out.sort(
    (a, b) => a.contentDir.localeCompare(b.contentDir) || a.lang.localeCompare(b.lang),
  );
};

/** Every `<lang>.w3strings` under `root`, sorted by folder then language. */
export const listW3StringsFiles = (root: string): W3LanguageFile[] =>
  listLanguageFiles(root, w3StringsLangFromFileName);

/** Every `<lang>pc.w3speech` voice container under `root`. */
export const listW3SpeechFiles = (root: string): W3LanguageFile[] =>
  listLanguageFiles(root, w3SpeechLangFromFileName);

/** Languages present anywhere under `root`, with how many tables each has. */
const countW3StringsLanguages = (files: readonly W3LanguageFile[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.lang, (counts.get(file.lang) ?? 0) + 1);
  return counts;
};

/**
 * The language the import treats as source: `preferred` when any table is in
 * it, else English, else whichever language has the most tables.
 */
export const resolveW3SourceLang = (
  files: readonly W3LanguageFile[],
  preferred: string,
): string | null => {
  const counts = countW3StringsLanguages(files);
  if (counts.size === 0) return null;
  if (counts.has(preferred)) return preferred;
  if (counts.has('en')) return 'en';
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
};

/**
 * Resolve the scanned root from an import anchor. The anchor is one
 * `.w3strings` file; the root is the extract directory the job stored, and
 * failing that the folder above the anchor's `content` chain.
 */
export const resolveW3ExtractRoot = (anchorPath: string, extractDir: string | null): string => {
  if (extractDir && extractDir.length > 0) return extractDir;
  if (fs.existsSync(anchorPath) && fs.statSync(anchorPath).isDirectory()) return anchorPath;
  return path.dirname(anchorPath);
};

/**
 * Game language codes that differ from the app's locale tags. Everything else
 * — `en`, `pl`, `esmx`, `cz` — is stored under the game's own code, the way
 * the Creation Engine titles store theirs. The Remastered edition (2026) ships
 * Ukrainian as `ua.w3strings`, and the app calls Ukrainian `uk`.
 */
const APP_LOCALE_BY_GAME_CODE: Readonly<Record<string, string>> = { ua: 'uk' };

/** The app locale a game language code is stored under. */
export const w3AppLocale = (gameCode: string): string => {
  const code = gameCode.toLowerCase();
  return APP_LOCALE_BY_GAME_CODE[code] ?? code;
};

/** The table a translation into `targetLang` is written as: `uk` → `ua.w3strings`. */
export const w3SlotForTargetLang = (targetLang: string): string => {
  const lang = targetLang.toLowerCase();
  return Object.entries(APP_LOCALE_BY_GAME_CODE).find(([, app]) => app === lang)?.[0] ?? lang;
};
