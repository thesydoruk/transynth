import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import { writeBa2, type Ba2InputFile } from '../bethesda/ba2Writer.js';
import { patchEsp, patchStringsMap, type EspPatch } from '../bethesda/espWriter.js';
import { parseStringsBuffer, stringsTypeFromPath, writeStringsBuffer, type StringsType } from '../bethesda/stringsFile.js';
import { log } from '../logger.js';

type SourceStringsFile = {
  nameStem: string;
  type: StringsType;
  sourceMap: Map<number, string>;
};

export type ExportedStringsFile = {
  fileName: string;
  size: number;
  contentBase64: string;
};

const findBa2 = (modPath: string): string | null => {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath));
  for (const candidate of [`${stem} - Main.ba2`, `${stem}.ba2`]) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

const loadSourceStringsFromBA2 = (ba2Path: string, srcLang: string): SourceStringsFile[] => {
  const ba2 = new Ba2Reader(ba2Path);
  const files: SourceStringsFile[] = [];

  for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
    for (const entry of ba2.listByExt(ext)) {
      const base = (entry.name.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
      if (!base.includes(`_${srcLang.toLowerCase()}.`)) continue;
      const type = stringsTypeFromPath(entry.name);
      const sourceMap = parseStringsBuffer(ba2.extractEntry(entry), type);
      const nameStem = base.replace(new RegExp(`_${srcLang.toLowerCase()}\.(strings|dlstrings|ilstrings)$`), '');
      files.push({ nameStem, type, sourceMap });
    }
  }

  return files;
}

const loadSourceStringsFromLooseFiles = (modPath: string, srcLang: string): SourceStringsFile[] => {
  const dir = path.join(path.dirname(modPath), 'Strings');
  if (!fs.existsSync(dir)) return [];

  const files: SourceStringsFile[] = [];
  for (const file of fs.readdirSync(dir)) {
    const lower = file.toLowerCase();
    if (!lower.includes(`_${srcLang.toLowerCase()}.`)) continue;
    const match = lower.match(/^(.*)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
    if (!match) continue;
    const type = stringsTypeFromPath(file);
    const sourceMap = parseStringsBuffer(fs.readFileSync(path.join(dir, file)), type);
    files.push({ nameStem: match[1], type, sourceMap });
  }

  return files;
}

const loadSourceStringsFiles = (modPath: string, srcLang: string): SourceStringsFile[] => {
  const ba2Path = findBa2(modPath);
  if (ba2Path) {
    const ba2Files = loadSourceStringsFromBA2(ba2Path, srcLang);
    if (ba2Files.length > 0) return ba2Files;
  }
  return loadSourceStringsFromLooseFiles(modPath, srcLang);
}

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

export const exportLocalizedStringsFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ExportedStringsFile[]> => {
  const sourceFiles = loadSourceStringsFiles(modPath, srcLang);
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

export const exportBa2Archive = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ExportedStringsFile> => {
  const stringsFiles = await exportLocalizedStringsFiles(db, modId, modPath, srcLang, targetLang);

  const ba2Files: Ba2InputFile[] = stringsFiles.map((f) => ({
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