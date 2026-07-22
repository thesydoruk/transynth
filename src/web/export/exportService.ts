/**
 * exportService.ts
 *
 * Export pipeline for translated game assets.
 *
 * This module converts translations stored in PostgreSQL into distributable
 * outputs that players can install:
 * - raw `.STRINGS` / `.DLSTRINGS` / `.ILSTRINGS` files,
 * - patched `.pex` Papyrus scripts,
 * - a patched ESP/ESM plugin for non-localized mods (inline text),
 * - and archives (BA2 for Fallout 4/76, BSA for Skyrim/FO3/FNV) or ZIP bundles.
 *
 * The export logic is intentionally deterministic:
 * - source file inventory is preserved (same stems/types as the imported mod),
 * - missing translations fall back to source text,
 * - and file ordering is stable for reproducibility and testability.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { Ba2Reader, writeBa2, usesBa2Archives } from '../../formats/ba2';
import { BsaReader, writeBsa } from '../../formats/bsa';
import type { EspPatch } from '../../formats/types';
import { patchEsp, patchStringsMap } from '../../formats/esp';
import { patchPexBuffer, collectModPexSources } from '../../formats/pex';
import {
  parseStringsBuffer,
  stringsTypeFromPath,
  writeStringsBuffer,
  type StringsType,
} from '../../formats/strings';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import { ensureDir } from '../../utils/file';
import {
  appendArchiveBuild,
  buildArchiveInputFile,
  discoverCompanionBa2,
  resolveScriptsArchiveFileName,
  resolveStringsArchiveFileName,
  type ExportArchiveBuild,
} from './archiveExportPlan';

/**
 * Parsed source strings table loaded from the original mod distribution.
 *
 * Each table includes its original file name (for inventory preservation),
 * its derived stem and type, and a full `lstring_id → sourceText` map.
 */
type SourceStringsFile = {
  sourceFileName: string;
  nameStem: string;
  type: StringsType;
  sourceMap: Map<number, string>;
};

/**
 * File descriptor returned by export endpoints.
 *
 * The HTTP layer typically returns these objects directly as JSON; binary
 * content is represented as base64 to keep the transport simple.
 */
export type ExportedStringsFile = {
  fileName: string;
  size: number;
  contentBase64: string;
};

/** Controls whether patched PEX scripts are included in archive export. */
export type ArchiveExportOptions = {
  includeScripts?: boolean;
};

/**
 * Bulk / CLI release export options.
 *
 * Defaults match the mass-localization script:
 * - strings embedded in the plugin (patched ESP),
 * - scripts exported as loose files under `Scripts\` (not repacked),
 * - no BA2/BSA archive created.
 */
export type ModReleaseExportOptions = {
  /** Export external STRINGS tables instead of patching the ESP. */
  forceLocalized?: boolean;
  /** Pack STRINGS (and optionally scripts) into a BA2/BSA archive. */
  repackArchives?: boolean;
  /** Patch and export compiled Papyrus scripts (default: true). */
  localizeScripts?: boolean;
};

export type ModReleaseExportResult = {
  modId: number;
  modName: string;
  outDir: string;
  files: string[];
  warnings: string[];
};

export type ModExportTarget = {
  modId: number;
  modName: string;
  modPath: string;
  srcLang: string;
  game: GameType;
  isLocalized: boolean;
};

/**
 * Parse a localized strings table file name while preserving the original
 * basename casing.
 *
 * Expected shape: `{Stem}_{locale}.{STRINGS|DLSTRINGS|ILSTRINGS}`.
 * Matching is case-insensitive, but the returned stem keeps the exact bytes
 * from the original file name so exports can preserve the visible file naming.
 *
 * @param fileName - Basename only, without directory components.
 * @returns Parsed descriptor or null if the file is not a strings table.
 */
const parseStringsFileName = (
  fileName: string,
): { nameStem: string; locale: string; type: StringsType } | null => {
  const match = fileName.match(/^(.*)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
  if (!match) return null;
  return {
    nameStem: match[1],
    locale: match[2].toLowerCase(),
    type: stringsTypeFromPath(fileName),
  };
};

/**
 * Keep strings file export order deterministic regardless of filesystem or
 * archive iteration order.
 *
 * @param files - Parsed source strings files.
 * @returns A stable, case-insensitive sort by source file name.
 */
const sortSourceStringsFiles = (files: SourceStringsFile[]): SourceStringsFile[] => {
  const typeOrder: Record<StringsType, number> = {
    STRINGS: 0,
    DLSTRINGS: 1,
    ILSTRINGS: 2,
  };

  return [...files].sort((left, right) => {
    const stemCompare = left.nameStem.localeCompare(right.nameStem, undefined, {
      sensitivity: 'base',
    });
    if (stemCompare !== 0) return stemCompare;
    return typeOrder[left.type] - typeOrder[right.type];
  });
};

/**
 * Discover a BA2 archive (Fallout 4/76) next to the plugin file.
 *
 * @deprecated Use {@link discoverCompanionBa2} from archiveExportPlan.
 */
const findBa2 = (modPath: string, game: GameType = 'fo4'): string | null =>
  discoverCompanionBa2(modPath, game);

/**
 * Discover a BSA archive (Skyrim SE) next to the mod plugin file.
 * Prefers "Stem - Strings.bsa", then "Stem.bsa".
 */
const findBsa = (modPath: string): string | null => {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath));
  for (const candidate of [`${stem} - Strings.bsa`, `${stem}.bsa`]) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
};

/**
 * Load source STRINGS files from a BSA archive (Skyrim SE/LE).
 */
const loadSourceStringsFromBSA = (bsaPath: string, srcLang: string): SourceStringsFile[] => {
  const bsa = new BsaReader(bsaPath);
  const files: SourceStringsFile[] = [];

  for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
    for (const entry of bsa.listByExt(ext)) {
      const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
      const parsed = parseStringsFileName(base);
      if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
      const sourceMap = parseStringsBuffer(bsa.extractEntry(entry), parsed.type);
      files.push({
        sourceFileName: base,
        nameStem: parsed.nameStem,
        type: parsed.type,
        sourceMap,
      });
    }
  }

  return sortSourceStringsFiles(files);
};

/**
 * Load source STRINGS tables from a BA2 archive for the requested locale.
 *
 * @param ba2Path - Absolute path to the BA2 archive.
 * @param srcLang - Locale suffix expected in file names (e.g. `"en"`).
 * @returns Stable-sorted list of parsed source strings tables.
 */
const loadSourceStringsFromBA2 = (ba2Path: string, srcLang: string): SourceStringsFile[] => {
  const ba2 = new Ba2Reader(ba2Path);
  const files: SourceStringsFile[] = [];

  for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
    for (const entry of ba2.listByExt(ext)) {
      const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
      const parsed = parseStringsFileName(base);
      if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
      const sourceMap = parseStringsBuffer(ba2.extractEntry(entry), parsed.type);
      files.push({
        sourceFileName: base,
        nameStem: parsed.nameStem,
        type: parsed.type,
        sourceMap,
      });
    }
  }

  return sortSourceStringsFiles(files);
};

/**
 * Load source STRINGS tables from loose files next to the plugin.
 *
 * This is supported for mods distributed with a `Strings\\` directory rather
 * than an archive.
 *
 * @param modPath - Absolute path to the mod plugin file.
 * @param srcLang - Locale suffix expected in file names (e.g. `"en"`).
 * @returns Stable-sorted list of parsed source strings tables.
 */
const loadSourceStringsFromLooseFiles = (modPath: string, srcLang: string): SourceStringsFile[] => {
  const dir = path.join(path.dirname(modPath), 'Strings');
  if (!fs.existsSync(dir)) return [];

  const files: SourceStringsFile[] = [];
  for (const file of fs.readdirSync(dir)) {
    const parsed = parseStringsFileName(file);
    if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
    const sourceMap = parseStringsBuffer(fs.readFileSync(path.join(dir, file)), parsed.type);
    files.push({
      sourceFileName: file,
      nameStem: parsed.nameStem,
      type: parsed.type,
      sourceMap,
    });
  }

  return sortSourceStringsFiles(files);
};

/**
 * Load all source strings tables for a given mod and locale.
 *
 * The search order depends on the game:
 * - Skyrim: BSA → BA2 → loose files.
 * - Fallout 4/76: BA2 → loose files.
 *
 * @param modPath - Absolute path to the mod plugin file.
 * @param srcLang - Source locale suffix (e.g. `"en"`).
 * @param game - Target game type (controls which archive types to probe first).
 * @returns Stable-sorted list of parsed source strings tables.
 */
const loadSourceStringsFiles = (
  modPath: string,
  srcLang: string,
  game: GameType = 'fo4',
): SourceStringsFile[] => {
  if (game === 'sse' || game === 'sle') {
    // Skyrim: try BSA first, then BA2 (some SSE mods use BA2), then loose files
    const bsaPath = findBsa(modPath);
    if (bsaPath) {
      const bsaFiles = loadSourceStringsFromBSA(bsaPath, srcLang);
      if (bsaFiles.length > 0) return bsaFiles;
    }
  }
  const ba2Path = findBa2(modPath, game);
  if (ba2Path) {
    try {
      const ba2Files = loadSourceStringsFromBA2(ba2Path, srcLang);
      if (ba2Files.length > 0) return ba2Files;
    } catch (err) {
      log.warn(
        `STRINGS export: failed to read source tables from ${path.basename(ba2Path)}: ${
          err instanceof Error ? err.message : String(err)
        }; falling back to loose Strings\\`,
      );
    }
  }
  return loadSourceStringsFromLooseFiles(modPath, srcLang);
};

/**
 * Build an overlay map of `lstring_id → export_text` for a mod and language pair.
 *
 * The query selects one "best" translation per source string according to
 * status and confidence, then falls back to the original source text when no
 * translation exists. The result can be applied to each source strings table
 * via {@link patchStringsMap}.
 *
 * @param db - Database transaction/pool wrapper.
 * @param modId - Mod identifier.
 * @param srcLang - Source language code of the stored strings rows.
 * @param targetLang - Desired target language code.
 * @returns Map keyed by `lstring_id` containing the chosen export text.
 */
const getTranslationOverlay = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<Map<number, string>> => {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.lstring_id)
        s.lstring_id,
        COALESCE(t.text, s.text_raw) AS export_text
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $3
       AND t.id = (
         SELECT id FROM translations
         WHERE src_string_id = s.id AND target_lang = $3
         ORDER BY CASE status
           WHEN 'draft' THEN 1
           WHEN 'reviewed' THEN 2
           WHEN 'human' THEN 3
           WHEN 'tm' THEN 4
           WHEN 'fuzzy' THEN 5
           WHEN 'auto' THEN 6
           WHEN 'rejected' THEN 7
           ELSE 8 END,
           COALESCE(confidence, 0) DESC,
           updated_at DESC
         LIMIT 1
       )
     WHERE r.mod_id = $1 AND s.lang = $2 AND s.lstring_id IS NOT NULL
     ORDER BY s.lstring_id, s.created_at DESC`,
    [modId, srcLang, targetLang],
  );

  const overlay = new Map<number, string>();
  for (const row of rows as Array<{ lstring_id: number; export_text: string }>) {
    overlay.set(row.lstring_id, row.export_text);
  }
  return overlay;
};

/**
 * Export translated strings tables for a localized mod (external STRINGS).
 *
 * The export:
 * - loads the source strings tables for `srcLang` from the mod distribution,
 * - builds a translation overlay from the DB,
 * - applies the overlay with source fallback,
 * - and serialises each table to the correct binary format.
 *
 * @param db - Database handle.
 * @param modId - Mod id whose translations should be exported.
 * @param modPath - Absolute path to the imported plugin file (used to find archives).
 * @param srcLang - Source locale suffix (e.g. `"en"`).
 * @param targetLang - Target locale suffix (e.g. `"uk"`).
 * @param game - Target game type (controls archive probing rules).
 * @returns List of exported strings files encoded as base64 payloads.
 */
export const exportLocalizedStringsFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ExportedStringsFile[]> => {
  const sourceFiles = loadSourceStringsFiles(modPath, srcLang, game);
  if (sourceFiles.length === 0) {
    throw new Error(`No source .STRINGS files found for locale ${srcLang}`);
  }

  const overlay = await getTranslationOverlay(db, modId, srcLang, targetLang);
  if (overlay.size === 0) {
    throw new Error(`No localized string IDs found for mod ${modId} and locale ${srcLang}`);
  }

  return sourceFiles.map((sourceFile) => {
    const patched = patchStringsMap(sourceFile.sourceMap, overlay);
    const buf = writeStringsBuffer(patched, sourceFile.type);
    return {
      fileName: `${sourceFile.nameStem}_${targetLang.toLowerCase()}.${sourceFile.type}`,
      size: buf.length,
      contentBase64: buf.toString('base64'),
    };
  });
};

// ────────────────────────────────────────────────────────────────────────────
// BA2 archive export — pack localized STRINGS into a BA2
// ────────────────────────────────────────────────────────────────────────────

const writeBuiltArchives = (
  builds: Map<string, ExportArchiveBuild>,
  game: GameType,
): ExportedStringsFile[] => {
  if (builds.size === 0) {
    throw new Error('No exportable STRINGS or PEX content for archive export');
  }

  const exported: ExportedStringsFile[] = [];
  for (const build of builds.values()) {
    const buf =
      build.archiveType === 'ba2'
        ? writeBa2(build.files)
        : writeBsa(build.files, game === 'sse' ? 105 : 104);
    exported.push({
      fileName: build.fileName,
      size: buf.length,
      contentBase64: buf.toString('base64'),
    });
  }

  exported.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' }),
  );
  return exported;
};

/**
 * Build one or more game archives with Creation Kit compression and naming rules.
 *
 * When string tables originally lived in `{Stem} - Interface.ba2`, they are repacked
 * there and patched PEX scripts go to `{Stem} - Main.ba2`.
 */
export const exportGameArchives = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile[]> => {
  const includeScripts = options.includeScripts !== false;
  const archiveType = usesBa2Archives(game) ? 'ba2' : 'bsa';
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const scriptsArchiveFileName = resolveScriptsArchiveFileName(stem, stringsArchiveFileName, game);
  const builds = new Map<string, ExportArchiveBuild>();

  try {
    const stringsFiles = await exportLocalizedStringsFiles(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      game,
    );
    appendArchiveBuild(
      builds,
      archiveType,
      stringsArchiveFileName,
      stringsFiles.map((file) =>
        buildArchiveInputFile(
          archiveType,
          stringsArchiveFileName,
          `Strings\\${file.fileName}`,
          Buffer.from(file.contentBase64, 'base64'),
          game,
        ),
      ),
    );
    log.info(
      `Archive export: prepared ${stringsFiles.length} STRINGS file(s) for ${stringsArchiveFileName}`,
    );
  } catch {
    log.info(`Archive export: no localized STRINGS for mod ${modId}, skipping strings tables`);
  }

  if (includeScripts) {
    try {
      const pexFiles = await exportPatchedPexFiles(db, modId, modPath, srcLang, targetLang);
      appendArchiveBuild(
        builds,
        archiveType,
        scriptsArchiveFileName,
        pexFiles.map((file) =>
          buildArchiveInputFile(
            archiveType,
            scriptsArchiveFileName,
            file.fileName,
            Buffer.from(file.contentBase64, 'base64'),
            game,
          ),
        ),
      );
      log.info(
        `Archive export: prepared ${pexFiles.length} PEX script(s) for ${scriptsArchiveFileName}`,
      );
    } catch {
      log.info(`Archive export: no patched PEX scripts for mod ${modId}, skipping scripts`);
    }
  }

  return writeBuiltArchives(builds, game);
};

/**
 * Export a single archive that contains translated strings tables.
 *
 * For Fallout 4/76, this produces a BA2 archive. For Skyrim/FO3/FNV, this
 * produces a BSA archive. The choice is automatic based on {@link GameType}.
 *
 * When both Interface (strings) and Main (scripts) archives are required, this
 * returns only the strings archive. Use {@link exportGameArchives} for all outputs.
 */
export const exportBa2Archive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile> => {
  const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, options);
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const stringsArchive =
    archives.find((archive) => archive.fileName === stringsArchiveFileName) ?? archives[0];
  if (!stringsArchive) {
    throw new Error(`No exportable STRINGS or PEX content for mod ${modId}`);
  }
  return stringsArchive;
};

// ────────────────────────────────────────────────────────────────────────────
// BSA archive export — pack localized STRINGS into a BSA (Skyrim SE / SLE)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a BSA v105 archive containing localized STRINGS/DLSTRINGS/ILSTRINGS
 * files.  This is the Skyrim SE equivalent of exportBa2Archive.
 */
export const exportBsaArchive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'sse',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile> => {
  const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, options);
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const stringsArchive =
    archives.find((archive) => archive.fileName === stringsArchiveFileName) ?? archives[0];
  if (!stringsArchive) {
    throw new Error(`No exportable STRINGS or PEX content for mod ${modId}`);
  }
  return stringsArchive;
};

/**
 * Game-aware archive dispatcher: exports a BA2 for Fallout 4/76 or a BSA for
 * Skyrim SE / Skyrim LE / Fallout 3 / Fallout NV.
 */
export const exportArchive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  options: ArchiveExportOptions = {},
): Promise<ExportedStringsFile> => {
  const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, options);
  const stem = path.basename(modPath, path.extname(modPath));
  const stringsArchiveFileName = resolveStringsArchiveFileName(modPath, stem, game);
  const stringsArchive =
    archives.find((archive) => archive.fileName === stringsArchiveFileName) ?? archives[0];
  if (!stringsArchive) {
    throw new Error(`No exportable STRINGS or PEX content for mod ${modId}`);
  }
  return stringsArchive;
};

// ────────────────────────────────────────────────────────────────────────────
// Non-localized ESP patch export
// ────────────────────────────────────────────────────────────────────────────

const getEspPatches = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<EspPatch[]> => {
  const { rows } = await db.query(
    `SELECT r.formid_hex, r.path, t.text
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $3
       AND t.id = (
         SELECT id FROM translations
         WHERE src_string_id = s.id AND target_lang = $3
         ORDER BY CASE status
           WHEN 'reviewed' THEN 1
           WHEN 'human' THEN 2
           WHEN 'draft' THEN 3
           WHEN 'tm' THEN 4
           WHEN 'fuzzy' THEN 5
           WHEN 'auto' THEN 6
           WHEN 'rejected' THEN 7
           ELSE 8 END,
           COALESCE(confidence, 0) DESC,
           updated_at DESC
         LIMIT 1
       )
     WHERE r.mod_id = $1 AND s.lang = $2 AND s.lstring_id IS NULL`,
    [modId, srcLang, targetLang],
  );

  const patches: EspPatch[] = [];
  for (const row of rows as Array<{ formid_hex: string; path: string; text: string }>) {
    if (!row.formid_hex || !row.path || !row.text) continue;
    // records.path is "SIGNATURE\SUBRECORD" — we need just the subrecord part
    const parts = row.path.split('\\');
    const subrecord = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    patches.push({
      formId: row.formid_hex,
      subrecord,
      newText: row.text,
    });
  }
  return patches;
};

// ────────────────────────────────────────────────────────────────────────────
// PEX (compiled Papyrus script) patch export
// ────────────────────────────────────────────────────────────────────────────

/** Per-script overlay: source literal → export text. */
type PexScriptOverlays = Map<string, Map<string, string>>;

/**
 * Load translation overlays for all PEX rows of a mod.
 *
 * Keys are lowercased script names (`PEX\\{script}` path suffix).
 */
const getPexTranslationOverlays = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<PexScriptOverlays> => {
  const { rows } = await db.query(
    `SELECT r.path, s.text_raw AS source_text,
            COALESCE(t.text, s.text_raw) AS export_text
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $3
       AND t.id = (
         SELECT id FROM translations
         WHERE src_string_id = s.id AND target_lang = $3
         ORDER BY CASE status
           WHEN 'draft' THEN 1
           WHEN 'reviewed' THEN 2
           WHEN 'human' THEN 3
           WHEN 'tm' THEN 4
           WHEN 'fuzzy' THEN 5
           WHEN 'auto' THEN 6
           WHEN 'rejected' THEN 7
           ELSE 8 END,
           COALESCE(confidence, 0) DESC,
           updated_at DESC
         LIMIT 1
       )
     WHERE r.mod_id = $1 AND r.signature = 'PEX' AND s.lang = $2`,
    [modId, srcLang, targetLang],
  );

  const overlays: PexScriptOverlays = new Map();
  for (const row of rows as Array<{ path: string; source_text: string; export_text: string }>) {
    const match = row.path.match(/^PEX\\(.+)$/i);
    if (!match) continue;
    const scriptKey = match[1]!.toLowerCase();
    if (!overlays.has(scriptKey)) overlays.set(scriptKey, new Map());
    overlays.get(scriptKey)!.set(row.source_text, row.export_text);
  }
  return overlays;
};

/**
 * Export patched `.pex` files with translated string literals.
 *
 * Each returned file uses an archive-relative path such as `Scripts\\Foo.pex`.
 *
 * @param db - Database handle.
 * @param modId - Mod id whose PEX translations should be exported.
 * @param modPath - Absolute path to the imported plugin (used to locate sources).
 * @param srcLang - Source language code.
 * @param targetLang - Target language code.
 */
export const exportPatchedPexFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ExportedStringsFile[]> => {
  const overlays = await getPexTranslationOverlays(db, modId, srcLang, targetLang);
  if (overlays.size === 0) {
    throw new Error(`No PEX strings found for mod ${modId} and locale ${srcLang}`);
  }

  const sources = collectModPexSources(modPath);
  if (sources.size === 0) {
    throw new Error(`No .pex source files found next to ${modPath}`);
  }

  const exported: ExportedStringsFile[] = [];
  for (const [scriptKey, source] of sources) {
    const overlay = overlays.get(scriptKey);
    if (!overlay || overlay.size === 0) continue;

    const patched = patchPexBuffer(source.data, overlay);
    const fileName = source.archivePath.replace(/\\/g, '/').split('/').pop() ?? `${scriptKey}.pex`;
    exported.push({
      fileName: source.archivePath.includes('\\') ? source.archivePath : `Scripts\\${fileName}`,
      size: patched.length,
      contentBase64: patched.toString('base64'),
    });
  }

  if (exported.length === 0) {
    throw new Error(`No matching .pex sources for PEX translations on mod ${modId}`);
  }

  exported.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' }),
  );
  log.info(`PEX export: ${exported.length} script(s) for mod ${modId}`);
  return exported;
};

export const exportPatchedEsp = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ExportedStringsFile> => {
  if (!fs.existsSync(modPath)) {
    throw new Error(`Original ESP file not found: ${modPath}`);
  }

  const patches = await getEspPatches(db, modId, srcLang, targetLang);
  if (patches.length === 0) {
    throw new Error(`No translations found for non-localized export (mod ${modId})`);
  }

  log.info(`ESP export: ${patches.length} patches for mod ${modId}`);
  const originalBuf = fs.readFileSync(modPath);
  const patchedBuf = patchEsp(originalBuf, patches);
  const fileName = path.basename(modPath);

  return {
    fileName,
    size: patchedBuf.length,
    contentBase64: patchedBuf.toString('base64'),
  };
};

// ────────────────────────────────────────────────────────────────────────────
// ZIP export — langpack (loose files) and full localized mod (BA2)
// ────────────────────────────────────────────────────────────────────────────

const hasTranslationOverlayChanges = (
  sourceMap: Map<number, string>,
  overlay: Map<number, string>,
): boolean => {
  for (const [id, srcText] of sourceMap) {
    const exportText = overlay.get(id);
    if (exportText !== undefined && exportText !== srcText) return true;
  }
  return false;
};

const packFilesToZip = async (files: Array<{ name: string; data: Buffer }>): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { store: true });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const file of files) {
      archive.append(file.data, { name: file.name });
    }

    archive.finalize();
  });

/**
 * Builds a langpack ZIP with loose localization files only (no BA2/BSA).
 *
 * Includes only files that contain at least one translated string:
 * - STRINGS/DLSTRINGS/ILSTRINGS under `Strings\`
 * - patched ESP/ESM when the binary differs from the imported original
 * - patched PEX scripts under `Scripts\` when literals were translated
 */
export const exportLangpackZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}_langpack.zip`;
  const files: Array<{ name: string; data: Buffer }> = [];

  try {
    const sourceFiles = loadSourceStringsFiles(modPath, srcLang, game);
    const overlay = await getTranslationOverlay(db, modId, srcLang, targetLang);
    let stringsCount = 0;
    for (const sourceFile of sourceFiles) {
      if (!hasTranslationOverlayChanges(sourceFile.sourceMap, overlay)) continue;
      const patched = patchStringsMap(sourceFile.sourceMap, overlay);
      const buf = writeStringsBuffer(patched, sourceFile.type);
      const fileName = `${sourceFile.nameStem}_${targetLang.toLowerCase()}.${sourceFile.type}`;
      files.push({ name: `Strings/${fileName}`, data: buf });
      stringsCount++;
    }
    if (stringsCount > 0) {
      log.info(
        `Langpack export: included ${stringsCount} changed STRINGS file(s) for mod ${modId}`,
      );
    }
  } catch (err) {
    log.info(
      `Langpack export: no localized STRINGS for mod ${modId}, skipping strings tables (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    const patchedBuf = Buffer.from(esp.contentBase64, 'base64');
    const originalBuf = fs.readFileSync(modPath);
    if (!patchedBuf.equals(originalBuf)) {
      files.push({ name: esp.fileName, data: patchedBuf });
      log.info(`Langpack export: included patched ESP (${esp.size} bytes)`);
    }
  } catch {
    log.info(`Langpack export: no non-localized patches for mod ${modId}, skipping ESP`);
  }

  try {
    const overlays = await getPexTranslationOverlays(db, modId, srcLang, targetLang);
    const sources = collectModPexSources(modPath);
    let pexCount = 0;
    for (const [scriptKey, source] of sources) {
      const overlay = overlays.get(scriptKey);
      if (!overlay || overlay.size === 0) continue;
      const hasChanges = [...overlay.entries()].some(([src, exp]) => exp !== src);
      if (!hasChanges) continue;

      const patched = patchPexBuffer(source.data, overlay);
      const fileName =
        source.archivePath.replace(/\\/g, '/').split('/').pop() ?? `${scriptKey}.pex`;
      const archivePath = source.archivePath.includes('\\')
        ? source.archivePath
        : `Scripts\\${fileName}`;
      files.push({ name: archivePath.replace(/\\/g, '/'), data: patched });
      pexCount++;
    }
    if (pexCount > 0) {
      log.info(`Langpack export: included ${pexCount} changed PEX script(s) for mod ${modId}`);
    }
  } catch {
    log.info(`Langpack export: no patched PEX scripts for mod ${modId}, skipping Scripts`);
  }

  if (files.length === 0) {
    throw new Error(
      'No exportable langpack content found — no translated STRINGS, PEX scripts, or ESP patches available.',
    );
  }

  const zipBuffer = await packFilesToZip(files);
  log.info(`Langpack export: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
  return { zipBuffer, zipFileName };
};

/**
 * Builds a full localized mod ZIP from the import extract tree.
 *
 * Repacks all BA2/BSA archives with translated content and includes every other
 * mod asset (meshes, textures, plugins, pass-through archives) from the import.
 */
export const exportFullModZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}.zip`;

  const { stageFullLocalizedMod } = await import('./fullModStaging');
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (extractRoot) {
    const staging = await stageFullLocalizedMod(db, modId, modPath, srcLang, targetLang, game);
    try {
      const zipBuffer = await packFilesToZip(staging.files);
      log.info(
        `Full mod export: ZIP ready — ${staging.files.length} file(s), ${zipBuffer.length} bytes`,
      );
      return { zipBuffer, zipFileName };
    } finally {
      staging.cleanup();
    }
  }

  log.warn(
    `Full mod export: no import extract tree for mod ${modId}, falling back to translation-only archives`,
  );
  const files: Array<{ name: string; data: Buffer }> = [];

  try {
    const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game);
    for (const archive of archives) {
      files.push({
        name: archive.fileName,
        data: Buffer.from(archive.contentBase64, 'base64'),
      });
    }
  } catch {
    log.info(`Full mod export: no localized STRINGS for mod ${modId}, skipping archive`);
  }

  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    files.push({
      name: esp.fileName,
      data: Buffer.from(esp.contentBase64, 'base64'),
    });
  } catch {
    log.info(`Full mod export: no non-localized patches for mod ${modId}, skipping ESP`);
  }

  if (files.length === 0) {
    throw new Error(
      'No exportable content found — no localized STRINGS archive or non-localized ESP patches available.',
    );
  }

  const zipBuffer = await packFilesToZip(files);
  log.info(`Full mod export: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
  return { zipBuffer, zipFileName };
};

// ────────────────────────────────────────────────────────────────────────────
// Bulk / CLI release export — write distributable files to disk
// ────────────────────────────────────────────────────────────────────────────

const writeExportedFile = (outDir: string, file: ExportedStringsFile, written: string[]): void => {
  const relPath = file.fileName.replace(/\\/g, '/');
  const dest = path.join(outDir, relPath);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(file.contentBase64, 'base64'));
  written.push(relPath);
};

const writeLooseStringsFiles = (
  outDir: string,
  files: ExportedStringsFile[],
  written: string[],
): void => {
  const stringsDir = path.join(outDir, 'Strings');
  ensureDir(stringsDir);
  for (const file of files) {
    const dest = path.join(stringsDir, file.fileName);
    fs.writeFileSync(dest, Buffer.from(file.contentBase64, 'base64'));
    written.push(path.join('Strings', file.fileName).replace(/\\/g, '/'));
  }
};

const exportErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * List mods eligible for bulk export (completed import, plugin path on disk).
 */
export const listModExportTargets = async (
  db: Tx,
  opts: { modIds?: number[]; game?: GameType } = {},
): Promise<ModExportTarget[]> => {
  const params: unknown[] = [];
  const filters: string[] = [
    `m.abs_path IS NOT NULL`,
    `mi.status = 'completed'`,
    `mi.mod_id IS NOT NULL`,
  ];

  if (opts.modIds?.length) {
    params.push(opts.modIds);
    filters.push(`m.id = ANY($${params.length}::int[])`);
  }
  if (opts.game) {
    params.push(opts.game);
    filters.push(`COALESCE(m.game, mi.game, 'fo4') = $${params.length}`);
  }

  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    abs_path: string;
    src_lang: string | null;
    game: string | null;
    is_localized: number | null;
  }>(
    `SELECT DISTINCT ON (m.id)
        m.id AS mod_id,
        m.name AS mod_name,
        m.abs_path,
        mi.src_lang,
        COALESCE(m.game, mi.game, 'fo4') AS game,
        mi.is_localized
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id
     WHERE ${filters.join(' AND ')}
     ORDER BY m.id, mi.updated_at DESC`,
    params,
  );

  return rows
    .filter((row) => fs.existsSync(row.abs_path))
    .map((row) => ({
      modId: row.mod_id,
      modName: row.mod_name,
      modPath: row.abs_path,
      srcLang: row.src_lang ?? CONFIG.defaultSrcLang,
      game: (row.game ?? 'fo4') as GameType,
      isLocalized: (row.is_localized ?? 0) === 1,
    }));
};

/**
 * Export one mod's translation release to a directory on disk.
 *
 * Default behaviour (see {@link ModReleaseExportOptions}):
 * - patch the ESP with embedded translations when possible,
 * - fall back to loose STRINGS tables for localized mods,
 * - write patched PEX scripts as loose files under `Scripts\`,
 * - do not create BA2/BSA archives.
 */
export const exportModRelease = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
  outDir: string,
  options: ModReleaseExportOptions = {},
): Promise<ModReleaseExportResult> => {
  const forceLocalized = options.forceLocalized ?? false;
  const repackArchives = options.repackArchives ?? false;
  const localizeScripts = options.localizeScripts !== false;

  ensureDir(outDir);
  const written: string[] = [];
  const warnings: string[] = [];
  const modName = path.basename(modPath);

  if (forceLocalized) {
    try {
      const stringsFiles = await exportLocalizedStringsFiles(
        db,
        modId,
        modPath,
        srcLang,
        targetLang,
        game,
      );
      if (!repackArchives) {
        writeLooseStringsFiles(outDir, stringsFiles, written);
      }
    } catch (err) {
      warnings.push(`STRINGS: ${exportErrorMessage(err)}`);
    }
  } else {
    try {
      const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
      writeExportedFile(outDir, esp, written);
    } catch (espErr) {
      try {
        const stringsFiles = await exportLocalizedStringsFiles(
          db,
          modId,
          modPath,
          srcLang,
          targetLang,
          game,
        );
        if (!repackArchives) {
          writeLooseStringsFiles(outDir, stringsFiles, written);
        }
      } catch (stringsErr) {
        warnings.push(
          `ESP: ${exportErrorMessage(espErr)}; STRINGS fallback: ${exportErrorMessage(stringsErr)}`,
        );
      }
    }
  }

  if (localizeScripts && !repackArchives) {
    try {
      const pexFiles = await exportPatchedPexFiles(db, modId, modPath, srcLang, targetLang);
      for (const pex of pexFiles) {
        writeExportedFile(outDir, pex, written);
      }
    } catch (err) {
      warnings.push(`Scripts: ${exportErrorMessage(err)}`);
    }
  }

  if (repackArchives) {
    try {
      const archives = await exportGameArchives(db, modId, modPath, srcLang, targetLang, game, {
        includeScripts: localizeScripts,
      });
      for (const archive of archives) {
        writeExportedFile(outDir, archive, written);
      }
    } catch (err) {
      warnings.push(`Archive: ${exportErrorMessage(err)}`);
    }
  }

  if (written.length === 0) {
    throw new Error(
      `No exportable content for mod ${modId} (${modName}): ${warnings.join('; ') || 'nothing produced'}`,
    );
  }

  log.info(
    `Release export mod ${modId}: ${written.length} file(s) → ${outDir}` +
      (warnings.length ? ` (${warnings.length} warning(s))` : ''),
  );

  return { modId, modName, outDir, files: written, warnings };
};
