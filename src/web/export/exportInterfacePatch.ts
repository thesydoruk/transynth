import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import {
  interfaceTranslateArchivePathForSlot,
  interfaceTranslateExportSlots,
  interfaceTranslateKeyFromRecordPath,
  interfaceTranslateRecordPrefix,
  readInterfaceTranslateEntries,
  writeInterfaceTranslateBuffer,
} from '../../formats/interface';
import { log } from '../../logger';
import {
  modImportLocalizeDir,
  resolveModImportExtractRoot,
  resolveModImportLocalizeDir,
} from '../../modStorage/paths';
import { pluginSiblingRelPath } from '../../modImport/packages';
import type { GameType } from '../../types';
import { exportPatchedFontLibraries } from './exportFontPatch';
import type { ZipPackEntry } from './exportTypes';
import { readModInterfaceFile } from './modInterfaceFiles';

const readSourceInterfaceTranslateBuffer = (
  modPath: string,
  sourceLocale: string,
  game: GameType,
): Buffer | null => readModInterfaceFile(modPath, `Translate_${sourceLocale}.txt`, game);

const getInterfaceTranslationOverlay = async (
  db: Tx,
  modId: number,
  sourceLocale: string,
  srcLang: string,
  targetLang: string,
): Promise<Map<string, string>> => {
  const prefix = interfaceTranslateRecordPrefix(sourceLocale);
  const { rows } = await db.query(
    `SELECT r.path, COALESCE(t.text, s.text_raw) AS export_text
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $4
     WHERE r.mod_id = $1 AND r.signature = 'UI' AND r.path ILIKE $3`,
    [modId, srcLang, `${prefix.replace(/\\/g, '\\\\')}%`, targetLang],
  );

  const overlay = new Map<string, string>();
  for (const row of rows as Array<{ path: string; export_text: string }>) {
    const key = interfaceTranslateKeyFromRecordPath(row.path, sourceLocale);
    if (!key) continue;
    overlay.set(key, row.export_text);
  }
  return overlay;
};

export type InterfaceTranslateExportResult = {
  archivePath: string;
  buffer: Buffer;
  changedCount: number;
};

/** Build patched `Interface/Translate_*.txt` file(s) from DB translations. */
export const exportInterfaceTranslateFile = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
  sourceLocale = 'en',
): Promise<InterfaceTranslateExportResult[] | null> => {
  const sourceBuf = readSourceInterfaceTranslateBuffer(modPath, sourceLocale, game);
  if (!sourceBuf) return null;

  const sourceEntries = readInterfaceTranslateEntries(sourceBuf);
  if (sourceEntries.length === 0) return null;

  const overlay = await getInterfaceTranslationOverlay(
    db,
    modId,
    sourceLocale,
    srcLang,
    targetLang,
  );

  let changedCount = 0;
  const exportEntries = sourceEntries.map(({ key, text }) => {
    const exportText = overlay.get(key) ?? text;
    if (exportText !== text) changedCount++;
    return { key, text: exportText };
  });

  if (changedCount === 0) return null;

  const buffer = writeInterfaceTranslateBuffer(exportEntries);
  return interfaceTranslateExportSlots(targetLang, game).map((slot) => ({
    archivePath: interfaceTranslateArchivePathForSlot(slot),
    buffer,
    changedCount,
  }));
};

const walkInterfaceFiles = (
  rootDir: string,
  relPrefix = '',
): Array<{ relPath: string; absPath: string }> => {
  const out: Array<{ relPath: string; absPath: string }> = [];
  if (!fs.existsSync(rootDir)) return out;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const absPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkInterfaceFiles(absPath, relPath));
      continue;
    }
    out.push({ relPath: relPath.replace(/\\/g, '/'), absPath });
  }
  return out;
};

/** Collect binary Interface assets from `_localize_{hash}/{lang}/Interface/`. */
export const collectInterfaceLocalizeAssets = (
  modPath: string,
  targetLang: string,
  packageFolder = '',
): ZipPackEntry[] => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) return [];

  const localizeRoot = resolveModImportLocalizeDir(extractRoot, targetLang);
  if (!localizeRoot) return [];

  const ifaceRoot = packageFolder
    ? path.join(localizeRoot, packageFolder, 'Interface')
    : path.join(localizeRoot, 'Interface');
  if (!fs.existsSync(ifaceRoot)) return [];

  const packageDir = path.dirname(modPath);
  const entries: ZipPackEntry[] = [];

  for (const { relPath, absPath } of walkInterfaceFiles(ifaceRoot)) {
    const archivePath = pluginSiblingRelPath(packageDir, modPath, `Interface/${relPath}`);
    const baselinePath = path.join(packageDir, 'Interface', relPath.replace(/\//g, path.sep));
    const data = fs.readFileSync(absPath);
    if (fs.existsSync(baselinePath) && fs.readFileSync(baselinePath).equals(data)) continue;
    entries.push({ name: archivePath.replace(/\\/g, '/'), data });
  }

  return entries;
};

/** Write interface localize assets into a package directory during full-mod staging. */
export const applyInterfaceLocalizeAssets = (
  modPath: string,
  targetLang: string,
  packageDir: string,
): number => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) return 0;

  const localizeDir = modImportLocalizeDir(extractRoot, targetLang);
  const folder = path.relative(extractRoot, path.dirname(modPath)).replace(/\\/g, '/');
  const ifaceRoot =
    folder && folder !== '.'
      ? path.join(localizeDir, folder, 'Interface')
      : path.join(localizeDir, 'Interface');
  if (!fs.existsSync(ifaceRoot)) return 0;

  let written = 0;
  for (const { relPath, absPath } of walkInterfaceFiles(ifaceRoot)) {
    const dest = path.join(packageDir, 'Interface', relPath.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absPath, dest);
    written++;
  }
  return written;
};

/** Collect all interface patch files for langpack / full-mod export. */
export const collectInterfacePatchEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ZipPackEntry[]> => {
  const entries: ZipPackEntry[] = [];
  const packageFolder = (() => {
    const extractRoot = resolveModImportExtractRoot(modPath);
    if (!extractRoot) return '';
    const rel = path.relative(extractRoot, path.dirname(modPath)).replace(/\\/g, '/');
    return rel === '.' ? '' : rel;
  })();

  try {
    const translated = await exportInterfaceTranslateFile(
      db,
      modId,
      modPath,
      srcLang,
      targetLang,
      game,
    );
    if (translated) {
      for (const file of translated) {
        entries.push({
          name: file.archivePath.replace(/\\/g, '/'),
          data: file.buffer,
        });
      }
      log.info(
        `Interface export: ${translated[0]!.changedCount} changed line(s) in ${translated.length} Translate file(s)`,
      );
    }
  } catch (err) {
    log.info(
      `Interface export: Translate file skipped (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  for (const asset of collectInterfaceLocalizeAssets(modPath, targetLang, packageFolder)) {
    entries.push(asset);
  }

  const packageDir = path.dirname(modPath);
  const taken = new Set(entries.map((entry) => entry.name.toLowerCase()));
  for (const font of exportPatchedFontLibraries(modPath, targetLang, game)) {
    const name = pluginSiblingRelPath(packageDir, modPath, font.archivePath).replace(/\\/g, '/');
    // A library already delivered through the localize overlay wins.
    if (taken.has(name.toLowerCase())) continue;
    entries.push({ name, data: font.buffer });
  }

  if (entries.length > 0) {
    log.info(`Interface export: prepared ${entries.length} Interface file(s) for mod ${modId}`);
  }

  return entries;
};
