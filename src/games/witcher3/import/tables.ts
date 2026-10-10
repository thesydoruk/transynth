/**
 * Read every string table under an extract root into per-language maps.
 *
 * A row's identity is the table folder plus the numeric string id —
 * `content/content0` + `1053712` — because ids are only unique per table: two
 * mods drawn from the same id space can and do reuse each other's numbers.
 */
import fs from 'node:fs';
import type { CsvRow } from '../../../types';
import { listW3StringsFiles, resolveW3SourceLang, type W3LanguageFile } from '../packLayout';
import { decodeW3Strings } from '../w3strings';

/** `W3S\{contentDir}\{id}` — the stored record path of one string, whatever its kind. */
const W3_RECORD_PATH_PREFIX = 'W3S';

/** Record signature of a line somebody says in a scene. */
export const W3_DIALOGUE_SIGNATURE = 'W3D';
/** Record signature of every other string: UI, books, journal, item names. */
const W3_TEXT_SIGNATURE = 'W3S';
export const W3_RECORD_SIGNATURES = [W3_DIALOGUE_SIGNATURE, W3_TEXT_SIGNATURE] as const;

export const w3RecordPath = (contentDir: string, id: number): string =>
  `${W3_RECORD_PATH_PREFIX}\\${contentDir}\\${id}`;

/** Inverse of {@link w3RecordPath}; null for a path this plugin did not write. */
export const parseW3RecordPath = (
  recordPath: string,
): { contentDir: string; id: number } | null => {
  const prefix = `${W3_RECORD_PATH_PREFIX}\\`;
  if (!recordPath.startsWith(prefix)) return null;
  const rest = recordPath.slice(prefix.length);
  const sep = rest.lastIndexOf('\\');
  if (sep < 0) return null;
  const id = Number(rest.slice(sep + 1));
  if (!Number.isInteger(id) || id < 0) return null;
  return { contentDir: rest.slice(0, sep), id };
};

export type W3TableEntry = { contentDir: string; id: number; keyHash: number; text: string };

/** All languages found under a root: lang → (record path → entry). */
export type W3LanguageTables = Map<string, Map<string, W3TableEntry>>;

/** Options for {@link collectW3LanguageTables}. */
export type CollectW3TablesOptions = {
  /** Read only these languages (game codes). Unset reads every language present. */
  langs?: ReadonlySet<string>;
};

const readTable = (file: W3LanguageFile, into: Map<string, W3TableEntry>): void => {
  const decoded = decodeW3Strings(fs.readFileSync(file.absPath));
  for (const entry of decoded.entries) {
    if (!entry.text.trim()) continue;
    into.set(w3RecordPath(file.contentDir, entry.id), {
      contentDir: file.contentDir,
      id: entry.id,
      keyHash: entry.keyHash,
      text: entry.text,
    });
  }
};

export const collectW3LanguageTables = (
  root: string,
  options: CollectW3TablesOptions = {},
): W3LanguageTables => {
  const out: W3LanguageTables = new Map();
  for (const file of listW3StringsFiles(root)) {
    if (options.langs && !options.langs.has(file.lang)) continue;
    let table = out.get(file.lang);
    if (!table) {
      table = new Map();
      out.set(file.lang, table);
    }
    readTable(file, table);
  }
  return out;
};

/**
 * How many rows an import of `root` will write: the source language's string
 * count, decoded rather than guessed, since the progress bar depends on it and
 * decoding even the full game's tables takes well under a second per language.
 */
export const countW3SourceStrings = (root: string, preferredLang: string): number => {
  const files = listW3StringsFiles(root);
  const sourceLang = resolveW3SourceLang(files, preferredLang);
  if (!sourceLang) return 0;
  const table = new Map<string, W3TableEntry>();
  for (const file of files) if (file.lang === sourceLang) readTable(file, table);
  return table.size;
};

/**
 * Rows for the shared bulk insert. A string some scene speaks is a dialogue
 * record (`W3D`), so translation and verification treat it as speech; the same
 * set must be passed for every language, since the signature is part of the
 * record's identity.
 */
export const buildW3CsvRows = (
  table: Map<string, W3TableEntry>,
  spokenIds: ReadonlySet<number> = new Set(),
): CsvRow[] =>
  [...table.entries()].map(([recordPath, entry]) => ({
    FormID: '',
    Signature: spokenIds.has(entry.id) ? W3_DIALOGUE_SIGNATURE : W3_TEXT_SIGNATURE,
    Path: recordPath,
    PathSimplified: recordPath,
    Source: entry.text,
  }));
