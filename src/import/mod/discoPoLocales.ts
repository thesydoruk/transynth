/**
 * Collect Disco Translator Final Cut `.po` locales and map them to CsvRows.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  discoAudioDir,
  discoverDiscoLangFolders,
  listPoFilesInDir,
  listWavFilesRecursive,
  parsePoBuffer,
  type DiscoLangFolder,
  type PoEntry,
} from '../../formats/po';
import type { CsvRow } from '../../types';
import { discoPoEntryStorageKey } from './discoPoPath';
import { discoPoLocaleText } from './discoPoText';

export type DiscoPoLocaleBundle = {
  folder: DiscoLangFolder;
  /** Map of `relPoFile\\entryKey` → source/translated text */
  entries: Map<string, string>;
  /** Optional wav stem set for EDID hints (basename without extension) */
  wavStems: Set<string>;
};

/** Relative path of a `.po` file inside its language folder (forward slashes). */
const relPoName = (langFolder: string, poPath: string): string =>
  path.relative(langFolder, poPath).split(path.sep).join('/');

/** Index wav basenames under Audio/ for EDID hints. */
const collectWavStems = (langFolderAbs: string): Set<string> => {
  const audioDir = discoAudioDir(langFolderAbs);
  const stems = new Set<string>();
  for (const wav of listWavFilesRecursive(audioDir)) {
    stems.add(path.basename(wav, path.extname(wav)));
  }
  return stems;
};

/** Guess EDID from msgctxt / msgid when a matching wav exists. */
const resolveEdid = (entry: PoEntry, wavStems: Set<string>): string | undefined => {
  const candidates = [entry.msgctxt, entry.msgid]
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      const base = path.basename(s.replace(/\\/g, '/'));
      const noExt = base.replace(/\.(wav|fuz|xwm)$/i, '');
      return [base, noExt, s];
    });
  for (const c of candidates) {
    if (wavStems.has(c)) return c;
  }
  // Common Final Cut pattern: msgctxt is the audio asset name.
  if (entry.msgctxt && entry.msgctxt.length <= 180) return entry.msgctxt;
  return undefined;
};

/** Load one language folder into a key→text map. */
const loadDiscoPoLocale = (folder: DiscoLangFolder): DiscoPoLocaleBundle => {
  const entries = new Map<string, string>();
  const wavStems = collectWavStems(folder.absPath);
  for (const poPath of listPoFilesInDir(folder.absPath)) {
    const rel = relPoName(folder.absPath, poPath);
    const parsed = parsePoBuffer(fs.readFileSync(poPath));
    for (const entry of parsed) {
      const text = discoPoLocaleText(entry);
      if (!text.trim()) continue;
      const storageKey = discoPoEntryStorageKey(rel, entry.msgctxt, entry.msgid);
      entries.set(`${rel}\\${storageKey}`, text);
    }
  }
  return { folder, entries, wavStems };
};

/**
 * Collect all Final Cut language folders under an extract root.
 * Keys are `relPo\\msgctxt::msgid`.
 */
export const collectDiscoPoLocales = (extractRoot: string): Map<string, DiscoPoLocaleBundle> => {
  const out = new Map<string, DiscoPoLocaleBundle>();
  for (const folder of discoverDiscoLangFolders(extractRoot)) {
    const bundle = loadDiscoPoLocale(folder);
    if (bundle.entries.size === 0) continue;
    out.set(folder.locale, bundle);
  }
  return out;
};

/** Prefer `en`, else first locale with the most entries. */
export const resolveDiscoPoSourceLocale = (
  locales: Map<string, DiscoPoLocaleBundle>,
): string | null => {
  if (locales.size === 0) return null;
  if (locales.has('en')) return 'en';
  let best: string | null = null;
  let bestSize = -1;
  for (const [locale, bundle] of locales) {
    if (bundle.entries.size > bestSize) {
      best = locale;
      bestSize = bundle.entries.size;
    }
  }
  return best;
};

/** Count records for import job registration (max locale size). */
export const countDiscoPoTranslationRecords = (extractRoot: string): number => {
  const locales = collectDiscoPoLocales(extractRoot);
  let max = 0;
  for (const bundle of locales.values()) max = Math.max(max, bundle.entries.size);
  return max;
};

/**
 * Build CsvRows from a source locale map.
 * Path: `PO\\{relPo}\\{storageKey}` where storageKey may hash a long msgid.
 */
export const buildDiscoPoCsvRows = (
  entries: Map<string, string>,
  wavStems: Set<string> = new Set(),
): CsvRow[] => {
  const rows: CsvRow[] = [];
  for (const [compositeKey, text] of entries) {
    const sep = compositeKey.indexOf('\\');
    const relPo = sep >= 0 ? compositeKey.slice(0, sep) : '';
    const entryKey = sep >= 0 ? compositeKey.slice(sep + 1) : compositeKey;
    const ctxSep = entryKey.indexOf('::');
    const msgctxt = ctxSep >= 0 ? entryKey.slice(0, ctxSep) : '';
    const pathKey = `PO\\${relPo}\\${entryKey}`;
    const edid = resolveEdid({ msgctxt, msgid: text, msgstr: text, key: entryKey }, wavStems);
    rows.push({
      FormID: '',
      Signature: 'PO',
      Path: pathKey,
      PathSimplified: pathKey,
      Source: text,
      ...(edid ? { EDID: edid } : {}),
    });
  }
  return rows;
};

/** Resolve extract root from an import anchor (`.po` file or folder). */
export const resolveDiscoExtractRoot = (anchorPath: string): string => {
  if (fs.existsSync(anchorPath) && fs.statSync(anchorPath).isDirectory()) {
    return anchorPath;
  }
  // .../English_English_en/Dialogues.po → pack root (parent of lang folder)
  const langFolder = path.dirname(anchorPath);
  return path.dirname(langFolder);
};
