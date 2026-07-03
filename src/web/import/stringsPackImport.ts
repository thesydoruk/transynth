/**
 * Import orphaned STRINGS/DLSTRINGS/ILSTRINGS packs (no sibling plugin).
 *
 * Orphan files are grouped by stem (plugin name). Each group is imported as one
 * mod with all locales merged. Rows are enriched from the matching plugin so
 * records keep FormID, EDID, and subrecord paths instead of bare lstring ids.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StringsType } from '../../formats/types/StringsType';
import { EspReader, type EspStringRow } from '../../formats/esp';
import { parseStringsBuffer, stringsTypeFromPath } from '../../formats/strings';
import type { Tx } from '../../db';
import { upsertMod } from '../../db';
import { log } from '../../logger';
import type { CsvRow, GameType } from '../../types';
import { sha1Hex, sha1HexFile } from '../../utils/hash';
import { CONFIG } from '../../config';
import { bulkInsertModImportRows, type ModImportBulkRow } from './modImportBulk';
import { withDeferredImportIndexes, withModImportWriteLock } from './modImportIndexes';
import { deleteModData } from '../data/queries';

const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);
const STRINGS_DIR_NAMES = new Set(['strings']);
const SKIP_DIRS = new Set(['.transynth-extracted', '.git', 'node_modules']);
const STRINGS_FILE_RE = /^(.+)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i;

export type StringsPackFile = {
  filePath: string;
  stem: string;
  locale: string;
  type: StringsType;
};

/** One import candidate: all orphan strings files for a single plugin stem. */
export type StringsPackCandidate = {
  /** Plugin stem from file names, e.g. `fallout4`. */
  stem: string;
  packRoot: string;
  stringsDir: string;
  files: StringsPackFile[];
};

export type LstringEspIndex = Map<StringsType, Map<number, EspStringRow[]>>;

const isStringsDirName = (name: string): boolean => STRINGS_DIR_NAMES.has(name.toLowerCase());

/** Parse `{stem}_{locale}.strings` style file names. */
export const parseStringsFileName = (
  fileName: string,
): { stem: string; locale: string; type: StringsType } | null => {
  const m = fileName.match(STRINGS_FILE_RE);
  if (!m) return null;
  return {
    stem: m[1]!,
    locale: m[2]!.toLowerCase(),
    type: stringsTypeFromPath(m[3]!),
  };
};

/**
 * Map an ESP string row to the strings table type that resolves its lstring id.
 *
 * Fallout/Skyrim convention: INFO/NAM1 → DLSTRINGS, INFO/RNAM → ILSTRINGS,
 * everything else → STRINGS.
 */
export const resolveStringsTypeForEspRow = (row: EspStringRow): StringsType => {
  const sub = row.path.includes('\\') ? (row.path.split('\\').pop() ?? row.path) : row.path;
  if (row.signature === 'INFO') {
    if (sub === 'NAM1') return 'DLSTRINGS';
    if (sub === 'RNAM') return 'ILSTRINGS';
  }
  return 'STRINGS';
};

/** Build lstring id → ESP row lookup split by strings file type. */
export const buildLstringEspIndex = (espRows: EspStringRow[]): LstringEspIndex => {
  const index: LstringEspIndex = new Map();

  for (const row of espRows) {
    if (!row.isLstringId) continue;
    const id = Number.parseInt(row.text, 10);
    if (!Number.isFinite(id) || id <= 0) continue;

    const type = resolveStringsTypeForEspRow(row);
    if (!index.has(type)) index.set(type, new Map());
    const byId = index.get(type)!;
    const bucket = byId.get(id);
    if (bucket) bucket.push(row);
    else byId.set(id, [row]);
  }

  return index;
};

/** Convert one ESP row plus resolved text into a CSV/import row. */
export const espRowToCsvRow = (espRow: EspStringRow, text: string): CsvRow => ({
  FormID: espRow.formId,
  Signature: espRow.signature,
  EDID: espRow.edid || undefined,
  Path: `${espRow.signature}\\${espRow.path}`,
  PathSimplified: `${espRow.signature}\\${espRow.path}`,
  LStringID: Number.parseInt(espRow.text, 10),
  Source: text,
  DialogTopicFormID: espRow.dialogTopicFormId,
  PreviousInfoFormID: espRow.previousInfoFormId,
  SpeakerFormID: espRow.speakerFormId,
});

/** Collect plugin stems under a pack root (case-insensitive, without extension). */
export const collectPluginStems = (packRoot: string): Set<string> => {
  const stems = new Set<string>();

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || isStringsDirName(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PLUGIN_EXTS.has(ext)) continue;
      stems.add(path.basename(entry.name, ext).toLowerCase());
    }
  };

  walk(packRoot);
  return stems;
};

/** Find a plugin file for a stem within the given search roots. */
export const findPluginFile = (
  stem: string,
  searchDirs: string[],
  recursive = true,
): string | null => {
  const stemLower = stem.toLowerCase();

  const tryDir = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !SKIP_DIRS.has(entry.name) && !isStringsDirName(entry.name)) {
          const nested = tryDir(full);
          if (nested) return nested;
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PLUGIN_EXTS.has(ext)) continue;
      if (path.basename(entry.name, ext).toLowerCase() === stemLower) return full;
    }
    return null;
  };

  for (const dir of searchDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const hit = tryDir(path.resolve(dir));
    if (hit) return hit;
  }
  return null;
};

/** Resolve a plugin path from disk search and/or previously imported mods. */
export const resolvePluginPathForStem = async (
  stem: string,
  game: GameType,
  searchDirs: string[],
  db?: Tx,
): Promise<string | null> => {
  const fromDisk = findPluginFile(stem, searchDirs);
  if (fromDisk) return fromDisk;

  if (!db) return null;

  const stemLower = stem.toLowerCase();
  const { rows } = await db.query<{ abs_path: string }>(
    `SELECT abs_path FROM mods WHERE game = $1 AND abs_path IS NOT NULL`,
    [game],
  );

  for (const row of rows) {
    const pluginPath = row.abs_path;
    if (!pluginPath || !fs.existsSync(pluginPath)) continue;
    const ext = path.extname(pluginPath).toLowerCase();
    if (!PLUGIN_EXTS.has(ext)) continue;
    if (path.basename(pluginPath, ext).toLowerCase() === stemLower) return pluginPath;
  }

  return null;
};

const listOrphanStringsFiles = (stringsDir: string, packRoot: string): StringsPackFile[] => {
  const pluginStems = collectPluginStems(packRoot);
  const files: StringsPackFile[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(stringsDir);
  } catch {
    return files;
  }

  for (const fileName of entries) {
    const parsed = parseStringsFileName(fileName);
    if (!parsed) continue;
    if (pluginStems.has(parsed.stem.toLowerCase())) continue;

    files.push({
      filePath: path.join(stringsDir, fileName),
      stem: parsed.stem,
      locale: parsed.locale,
      type: parsed.type,
    });
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }));
  return files;
};

/** Group orphan strings files by plugin stem (case-insensitive key, original casing kept). */
export const groupStringsFilesByStem = (files: StringsPackFile[]): StringsPackFile[][] => {
  const groups = new Map<string, { stem: string; files: StringsPackFile[] }>();

  for (const file of files) {
    const key = file.stem.toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.files.push(file);
    else groups.set(key, { stem: file.stem, files: [file] });
  }

  return [...groups.values()]
    .sort((a, b) => a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' }))
    .map((g) =>
      g.files.sort((a, b) =>
        a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }),
      ),
    );
};

/**
 * Find orphaned strings groups under `scanDir`.
 *
 * Orphan files in each `strings/` folder are split by stem; every stem group
 * becomes a separate import candidate.
 */
export const discoverStringsPacks = (scanDir: string, recursive = true): StringsPackCandidate[] => {
  const packs: StringsPackCandidate[] = [];
  const seenStringsDirs = new Set<string>();

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (isStringsDirName(entry.name)) {
        const normalized = path.resolve(full);
        if (seenStringsDirs.has(normalized)) continue;
        seenStringsDirs.add(normalized);

        const packRoot = dir;
        const orphanFiles = listOrphanStringsFiles(full, packRoot);
        for (const stemFiles of groupStringsFilesByStem(orphanFiles)) {
          packs.push({
            stem: stemFiles[0]!.stem,
            packRoot,
            stringsDir: full,
            files: stemFiles,
          });
        }
        continue;
      }

      if (recursive) walk(full);
    }
  };

  walk(scanDir);
  packs.sort((a, b) => {
    const byStem = a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' });
    if (byStem !== 0) return byStem;
    return a.packRoot.localeCompare(b.packRoot, undefined, { sensitivity: 'base' });
  });
  return packs;
};

/** Build a stable content hash from all strings files in one stem group. */
export const computeStringsPackHash = async (files: StringsPackFile[]): Promise<string> => {
  const parts: string[] = [];
  for (const file of files) {
    const rel = path.basename(file.filePath);
    const hash = await sha1HexFile(file.filePath);
    parts.push(`${rel}:${hash}`);
  }
  return sha1Hex(parts.join('\n'));
};

/** Derive a mod name from the plugin stem and content hash. */
export const buildStringsPackModName = (stem: string, contentHash: string): string => {
  return `${stem}__${contentHash.slice(0, 8)}`;
};

/**
 * Build import rows by matching strings file entries to ESP lstring references.
 *
 * Each matched ESP row becomes one identifiable record (FormID, EDID, subrecord).
 */
export const buildStringsPackRows = (
  file: StringsPackFile,
  entries: Map<number, string>,
  lstringIndex: LstringEspIndex,
): { rows: CsvRow[]; mapped: number; unmapped: number } => {
  const rows: CsvRow[] = [];
  let mapped = 0;
  let unmapped = 0;
  const byId = lstringIndex.get(file.type) ?? new Map<number, EspStringRow[]>();

  for (const [id, text] of entries) {
    if (!text) continue;
    const espRows = byId.get(id);
    if (!espRows || espRows.length === 0) {
      unmapped++;
      continue;
    }
    for (const espRow of espRows) {
      rows.push(espRowToCsvRow(espRow, text));
      mapped++;
    }
  }

  return { rows, mapped, unmapped };
};

const countExistingRecords = async (db: Tx, modId: number): Promise<number> => {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM records WHERE mod_id = $1',
    [modId],
  );
  return Number(rows[0]?.count ?? 0);
};

export type StringsPackImportResult = {
  modId: number;
  modName: string;
  imported: number;
  skipped: boolean;
  locales: string[];
  stem: string;
  pluginPath: string;
  mappedEntries: number;
  unmappedEntries: number;
};

export type StringsPackImportOptions = {
  force?: boolean;
  /** Directories searched for `{stem}.esp/.esm/.esl` (e.g. game Data folder). */
  pluginSearchDirs?: string[];
};

/**
 * Import one stem group into the database.
 *
 * Requires the matching plugin on disk or in previously imported mods so rows
 * can be enriched with FormID / EDID / subrecord paths.
 */
export const importStringsPack = async (
  db: Tx,
  pack: StringsPackCandidate,
  game: GameType = 'fo4',
  options: StringsPackImportOptions = {},
): Promise<StringsPackImportResult> => {
  const force = options.force ?? false;
  const searchDirs = [
    ...(options.pluginSearchDirs ?? []),
    pack.packRoot,
    path.dirname(pack.stringsDir),
  ].filter((dir, index, all) => dir && all.indexOf(path.resolve(dir)) === index);

  const pluginPath = await resolvePluginPathForStem(pack.stem, game, searchDirs, db);
  if (!pluginPath) {
    throw new Error(
      `Plugin "${pack.stem}" not found for strings enrichment. ` +
        `Import the .esp/.esm first or pass --plugins-dir with game Data folder. ` +
        `Searched: ${searchDirs.join(', ')}`,
    );
  }

  const esp = new EspReader(pluginPath, game);
  if (!esp.info.isLocalized) {
    throw new Error(`Plugin "${pluginPath}" is not localized — strings tables are not used`);
  }

  const lstringIndex = buildLstringEspIndex(esp.extractStrings());
  const contentHash = await computeStringsPackHash(pack.files);
  const modName = buildStringsPackModName(pack.stem, contentHash);
  const locales = [...new Set(pack.files.map((f) => f.locale))].sort();
  const absPath = pluginPath;

  const { rows: existing } = await db.query<{ id: number }>(
    'SELECT id FROM mods WHERE name = $1 AND version_hash = $2',
    [modName, contentHash],
  );
  const existingModId = existing[0]?.id;

  if (existingModId != null && !force) {
    const recordCount = await countExistingRecords(db, existingModId);
    if (recordCount > 0) {
      return {
        modId: existingModId,
        modName,
        imported: recordCount,
        skipped: true,
        locales,
        stem: pack.stem,
        pluginPath,
        mappedEntries: recordCount,
        unmappedEntries: 0,
      };
    }
  }

  if (existingModId != null && force) {
    await deleteModData(db, existingModId, 'mod');
  }

  const modId = await upsertMod(db, modName, absPath, contentHash, game);
  const pending: ModImportBulkRow[] = [];
  let mappedEntries = 0;
  let unmappedEntries = 0;

  for (const file of pack.files) {
    const buf = fs.readFileSync(file.filePath);
    const entries = parseStringsBuffer(buf, file.type);
    const { rows, mapped, unmapped } = buildStringsPackRows(file, entries, lstringIndex);
    mappedEntries += mapped;
    unmappedEntries += unmapped;
    for (const csvRow of rows) {
      pending.push({
        csvRow,
        locale: file.locale,
        context: null,
        sourceKind: 'strings-pack',
      });
    }
  }

  if (pending.length === 0) {
    throw new Error(
      `No strings from "${pack.stem}" matched plugin records in "${path.basename(pluginPath)}". ` +
        `${unmappedEntries} lstring id(s) had no ESP references.`,
    );
  }

  const importBatchSize = CONFIG.dbChunkSize;
  let imported = 0;
  await withModImportWriteLock(db, async () => {
    await withDeferredImportIndexes(db, CONFIG.modImportDeferIndexes, async () => {
      for (let i = 0; i < pending.length; i += importBatchSize) {
        const batch = pending.slice(i, i + importBatchSize);
        const results = await bulkInsertModImportRows(db, modId, batch);
        imported += results.length;
        if (imported > 0 && imported % 5000 === 0) {
          log.info(`  strings pack "${modName}": ${imported}/${pending.length}`);
        }
      }
    });
  });

  if (unmappedEntries > 0) {
    log.warn(
      `[strings-pack ${pack.stem}] ${unmappedEntries} lstring id(s) in files had no matching ESP references and were skipped`,
    );
  }

  return {
    modId,
    modName,
    imported,
    skipped: false,
    locales,
    stem: pack.stem,
    pluginPath,
    mappedEntries,
    unmappedEntries,
  };
};
