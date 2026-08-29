/**
 * Export patched MCM Helper translation txt files for a mod.
 *
 * Source locale files (usually `*_en.txt`) are overlaid with DB translations and
 * written into each install slot from {@link exportLocaleSlots}.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import {
  listMcmTranslationDirs,
  mcmFileStemFromPath,
  mcmLocaleFromPath,
  mcmTranslationMatchesMod,
  parseMcmBuffer,
  resolveMcmModPrefix,
  resolveMcmTranslationPrefixes,
  resolveModDirectoryFromPath,
  writeMcmBuffer,
} from '../../formats/mcm';
import { exportLocaleSlots } from '../../locale/exportSlots';
import { log } from '../../logger';
import type { GameType } from '../../types';
import type { ZipPackEntry } from './exportTypes';

export type McmTranslateExportFile = {
  archivePath: string;
  buffer: Buffer;
  changedCount: number;
};

type McmSourceFile = {
  relDir: string;
  stem: string;
  entries: Array<{ key: string; text: string }>;
};

const mcmKeyFromRecordPath = (recordPath: string): string | null => {
  const normalized = recordPath.replace(/\//g, '\\');
  const match = normalized.match(/^MCM\\(\$.+)$/i);
  return match?.[1] ?? null;
};

const getMcmTranslationOverlay = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<Map<string, string>> => {
  const { rows } = await db.query(
    `SELECT r.path, COALESCE(t.text, s.text_raw) AS export_text
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1 AND r.signature = 'MCM'`,
    [modId, srcLang, targetLang],
  );

  const overlay = new Map<string, string>();
  for (const row of rows as Array<{ path: string; export_text: string }>) {
    const key = mcmKeyFromRecordPath(row.path);
    if (!key) continue;
    overlay.set(key, row.export_text);
  }
  return overlay;
};

const preferSourceLocale = (locales: string[]): string | null => {
  const lower = locales.map((l) => l.toLowerCase());
  for (const preferred of ['en', 'english']) {
    if (lower.includes(preferred)) return preferred;
  }
  return lower[0] ?? null;
};

type StemCandidate = { locale: string; absPath: string; relDir: string; stem: string };

const collectStemCandidates = (modPath: string): StemCandidate[] => {
  const modDir = resolveModDirectoryFromPath(modPath);
  const prefixes = resolveMcmTranslationPrefixes(modDir, resolveMcmModPrefix(modDir, modPath));
  const out: StemCandidate[] = [];

  for (const dir of listMcmTranslationDirs(modDir)) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const relDir = path.relative(modDir, dir).replace(/\\/g, '/');
    for (const file of files) {
      if (!mcmTranslationMatchesMod(file, prefixes)) continue;
      const locale = mcmLocaleFromPath(file);
      const stem = mcmFileStemFromPath(file);
      if (!locale || !stem) continue;
      out.push({ locale, absPath: path.join(dir, file), relDir, stem });
    }
  }
  return out;
};

/** Loose MCM source files for the preferred locale under a mod package. */
export const listMcmSourceTranslationFiles = (modPath: string): McmSourceFile[] => {
  const candidates = collectStemCandidates(modPath);
  if (candidates.length === 0) return [];

  const preferred = preferSourceLocale(candidates.map((c) => c.locale));
  if (!preferred) return [];

  const byStem = new Map<string, StemCandidate>();
  for (const candidate of candidates) {
    if (candidate.locale !== preferred) continue;
    byStem.set(`${candidate.relDir}\0${candidate.stem}`, candidate);
  }

  const out: McmSourceFile[] = [];
  for (const file of byStem.values()) {
    const map = parseMcmBuffer(fs.readFileSync(file.absPath));
    if (map.size === 0) continue;
    out.push({
      relDir: file.relDir,
      stem: file.stem,
      entries: [...map.entries()].map(([key, text]) => ({ key, text })),
    });
  }
  return out;
};

/** Build patched MCM translation files for langpack / full-mod export. */
export const exportMcmTranslationFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<McmTranslateExportFile[]> => {
  const sourceFiles = listMcmSourceTranslationFiles(modPath);
  if (sourceFiles.length === 0) return [];

  const overlay = await getMcmTranslationOverlay(db, modId, srcLang, targetLang);
  if (overlay.size === 0) return [];

  const slots = exportLocaleSlots(targetLang, game);
  const exported: McmTranslateExportFile[] = [];

  for (const source of sourceFiles) {
    let changedCount = 0;
    const exportEntries = source.entries.map(({ key, text }) => {
      const exportText = overlay.get(key) ?? text;
      if (exportText !== text) changedCount++;
      return { key, text: exportText };
    });
    if (changedCount === 0) continue;

    const buffer = writeMcmBuffer(exportEntries);
    for (const slot of slots) {
      const fileName = `${source.stem}_${slot}.txt`;
      const archivePath = path.posix.join(source.relDir, fileName);
      exported.push({ archivePath, buffer, changedCount });
    }
  }

  return exported;
};

/** Collect MCM patch ZIP entries relative to the mod package root. */
export const collectMcmPatchEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ZipPackEntry[]> => {
  try {
    const files = await exportMcmTranslationFiles(db, modId, modPath, srcLang, targetLang, game);
    if (files.length === 0) return [];
    log.info(`MCM export: prepared ${files.length} translation file(s) for mod ${modId}`);
    return files.map((file) => ({
      name: file.archivePath.replace(/\\/g, '/'),
      data: file.buffer,
    }));
  } catch (err) {
    log.info(
      `MCM export: skipped for mod ${modId} (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }
};
