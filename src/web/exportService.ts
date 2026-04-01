/**
 * exportService.ts
 *
 * Export pipeline for translated game assets.
 *
 * This module converts translations stored in PostgreSQL into distributable
 * outputs that players can install:
 * - raw `.STRINGS` / `.DLSTRINGS` / `.ILSTRINGS` files,
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
import type { Tx } from '../db';
import type { GameType } from '../types';
import { Ba2Reader, BsaReader, writeBa2, writeBsa } from '../bethesda/archives';
import type { ArchiveInputFile, EspPatch } from '../bethesda/types';
import { patchEsp, patchStringsMap } from '../bethesda/esp';
import { parseStringsBuffer, stringsTypeFromPath, writeStringsBuffer, type StringsType } from '../bethesda/strings';
import { log } from '../logger';

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
}

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
    const stemCompare = left.nameStem.localeCompare(right.nameStem, undefined, { sensitivity: 'base' });
    if (stemCompare !== 0) return stemCompare;
    return typeOrder[left.type] - typeOrder[right.type];
  });
}

/**
 * Discover a BA2 archive (Fallout 4/76) next to the plugin file.
 *
 * The tool follows common Fallout naming conventions:
 * - `{Stem} - Main.ba2`
 * - `{Stem}.ba2`
 *
 * @param modPath - Absolute path to the mod plugin file.
 * @returns Path to the discovered BA2 archive, or `null` when not found.
 */
const findBa2 = (modPath: string): string | null => {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath));
  for (const candidate of [`${stem} - Main.ba2`, `${stem}.ba2`]) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

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
}

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
}

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
}

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
}

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
const loadSourceStringsFiles = (modPath: string, srcLang: string, game: GameType = 'fo4'): SourceStringsFile[] => {
  if (game === 'sse' || game === 'sle') {
    // Skyrim: try BSA first, then BA2 (some SSE mods use BA2), then loose files
    const bsaPath = findBsa(modPath);
    if (bsaPath) {
      const bsaFiles = loadSourceStringsFromBSA(bsaPath, srcLang);
      if (bsaFiles.length > 0) return bsaFiles;
    }
  }
  const ba2Path = findBa2(modPath);
  if (ba2Path) {
    const ba2Files = loadSourceStringsFromBA2(ba2Path, srcLang);
    if (ba2Files.length > 0) return ba2Files;
  }
  return loadSourceStringsFromLooseFiles(modPath, srcLang);
}

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
const getTranslationOverlay = async (db: Tx, modId: number, srcLang: string, targetLang: string): Promise<Map<number, string>> => {
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
}

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
}

// ────────────────────────────────────────────────────────────────────────────
// BA2 archive export — pack localized STRINGS into a BA2
// ────────────────────────────────────────────────────────────────────────────

/**
 * Export a single archive that contains translated strings tables.
 *
 * For Fallout 4/76, this produces a BA2 archive. For Skyrim/FO3/FNV, this
 * produces a BSA archive. The choice is automatic based on {@link GameType}.
 *
 * @param db - Database handle.
 * @param modId - Mod id whose translations should be exported.
 * @param modPath - Absolute path to the imported plugin file (used to find archives).
 * @param srcLang - Source locale suffix (e.g. `"en"`).
 * @param targetLang - Target locale suffix (e.g. `"uk"`).
 * @param game - Target game type (controls archive type selection).
 * @returns Single exported archive file encoded as base64 payload.
 */
export const exportBa2Archive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ExportedStringsFile> => {
  const stringsFiles = await exportLocalizedStringsFiles(db, modId, modPath, srcLang, targetLang, game);

  const ba2Files: ArchiveInputFile[] = stringsFiles.map((f) => ({
    name: `Strings\\${f.fileName}`,
    data: Buffer.from(f.contentBase64, 'base64'),
  }));

  const ba2Buf = writeBa2(ba2Files);
  const stem = path.basename(modPath, path.extname(modPath));
  const fileName = `${stem} - Main.ba2`;

  return {
    fileName,
    size: ba2Buf.length,
    contentBase64: ba2Buf.toString('base64'),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// BSA archive export — pack localized STRINGS into a BSA (Skyrim SE / SLE)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a BSA v105 archive containing localized STRINGS/DLSTRINGS/ILSTRINGS
 * files.  This is the Skyrim SE equivalent of exportBa2Archive.
 *
 * @param db - Database connection
 * @param modId - Mod database ID
 * @param modPath - Path to the original plugin file (.esp/.esm/.esl)
 * @param srcLang - Source language code
 * @param targetLang - Target language code
 * @param game - Game type (should be 'sse' or 'sle')
 * @returns An ExportedStringsFile with the BSA contents (base-64 encoded)
 */
export const exportBsaArchive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'sse',
): Promise<ExportedStringsFile> => {
  const stringsFiles = await exportLocalizedStringsFiles(db, modId, modPath, srcLang, targetLang, game);

  const bsaFiles: ArchiveInputFile[] = stringsFiles.map((f) => ({
    name: `Strings\\${f.fileName}`,
    data: Buffer.from(f.contentBase64, 'base64'),
  }));

  // FO3, FNV, and SLE (Skyrim LE) use BSA v104; SSE (Skyrim SE) uses BSA v105
  const bsaVersion = game === 'sse' ? 105 : 104;
  const bsaBuf = writeBsa(bsaFiles, bsaVersion);
  const stem = path.basename(modPath, path.extname(modPath));
  const fileName = `${stem} - Strings.bsa`;

  return {
    fileName,
    size: bsaBuf.length,
    contentBase64: bsaBuf.toString('base64'),
  };
}

/**
 * Game-aware archive dispatcher: exports a BA2 for Fallout 4/76 or a BSA for
 * Skyrim SE / Skyrim LE / Fallout 3 / Fallout NV.  Routes and CLI code should
 * call this instead of exportBa2Archive / exportBsaArchive directly.
 */
export const exportArchive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ExportedStringsFile> => {
  if (game === 'sse' || game === 'sle' || game === 'fo3' || game === 'fnv') {
    return exportBsaArchive(db, modId, modPath, srcLang, targetLang, game);
  }
  return exportBa2Archive(db, modId, modPath, srcLang, targetLang, game);
}

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
}

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
}

// ────────────────────────────────────────────────────────────────────────────
// Project export — ZIP bundle with BA2 + patched ESP (everything in one file)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds a complete localization package as a ZIP archive.
 *
 * The ZIP contains:
 * - A BA2 archive with all localized STRINGS/DLSTRINGS/ILSTRINGS files
 *   (if the mod has any localized strings with lstring_id).
 * - A patched ESP/ESM/ESL plugin file with non-localized string translations
 *   (if the mod has any non-localized embedded strings).
 *
 * Either or both may be present depending on the mod structure.
 * If neither is available, an error is thrown.
 *
 * @param db - Database connection (transaction-capable)
 * @param modId - The mod's database ID
 * @param modPath - Absolute filesystem path to the original mod plugin file
 * @param srcLang - Source language code (e.g. 'en')
 * @param targetLang - Target language code (e.g. 'uk')
 * @returns A Buffer containing the ZIP archive
 */
export const exportProjectZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}.zip`;

  // Collect all exportable files; at least one must succeed
  const files: Array<{ name: string; data: Buffer }> = [];

  // 1. Try to export a BA2/BSA with localized STRINGS files (game-aware)
  try {
    const archive = await exportArchive(db, modId, modPath, srcLang, targetLang, game);
    files.push({
      name: archive.fileName,
      data: Buffer.from(archive.contentBase64, 'base64'),
    });
    log.info(`Project export: included archive ${archive.fileName} (${archive.size} bytes)`);
  } catch {
    log.info(`Project export: no localized STRINGS files for mod ${modId}, skipping archive`);
  }

  // 2. Try to export a patched ESP
  try {
    const esp = await exportPatchedEsp(db, modId, modPath, srcLang, targetLang);
    files.push({
      name: esp.fileName,
      data: Buffer.from(esp.contentBase64, 'base64'),
    });
    log.info(`Project export: included patched ESP (${esp.size} bytes)`);
  } catch {
    log.info(`Project export: no non-localized patches for mod ${modId}, skipping ESP`);
  }

  if (files.length === 0) {
    throw new Error('No exportable content found — neither localized STRINGS nor non-localized ESP patches available.');
  }

  // 3. Pack everything into a ZIP archive using archiver (store mode — no compression,
  //    because BA2 and ESP files are already binary and don't compress well)
  const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
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

  log.info(`Project export: ZIP ready — ${files.length} file(s), ${zipBuffer.length} bytes`);
  return { zipBuffer, zipFileName };
}