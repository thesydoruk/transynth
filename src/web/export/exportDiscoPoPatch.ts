/**
 * Export Disco Translator Final Cut `.po` language packs with translation overlays.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import {
  discoLangFolderNameForLocale,
  discoverDiscoLangFolders,
  listPoFilesInDir,
  writePoWithOverlays,
} from '../../formats/po';
import { log } from '../../logger';
import { resolveDiscoExtractRoot } from '../../import/mod/discoPoLocales';
import type { ZipPackEntry } from './exportTypes';

/** Parse `PO\\relPo\\msgctxt::msgid` into file + entry key. */
const parseDiscoPoRecordPath = (recordPath: string): { relPo: string; entryKey: string } | null => {
  const normalized = recordPath.replace(/\//g, '\\');
  if (!normalized.toUpperCase().startsWith('PO\\')) return null;
  const rest = normalized.slice(3);
  const sep = rest.indexOf('\\');
  if (sep < 0) return null;
  return {
    relPo: rest.slice(0, sep).replace(/\\/g, '/'),
    entryKey: rest.slice(sep + 1),
  };
};

/** Load DB overlays grouped by relative `.po` file path. */
const getDiscoPoOverlaysByFile = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<Map<string, Map<string, string>>> => {
  const { rows } = await db.query(
    `SELECT r.path, COALESCE(t.text, s.text_raw) AS export_text
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1 AND r.signature = 'PO'`,
    [modId, srcLang, targetLang],
  );

  const byFile = new Map<string, Map<string, string>>();
  for (const row of rows as Array<{ path: string; export_text: string }>) {
    const parsed = parseDiscoPoRecordPath(row.path);
    if (!parsed) continue;
    if (!byFile.has(parsed.relPo)) byFile.set(parsed.relPo, new Map());
    byFile.get(parsed.relPo)!.set(parsed.entryKey, row.export_text);
  }
  return byFile;
};

/** Prefer English language folder under the extract tree. */
const findSourceDiscoLangFolder = (extractRoot: string): string | null => {
  const folders = discoverDiscoLangFolders(extractRoot);
  if (folders.length === 0) return null;
  return (
    folders.find((f) => f.locale === 'en')?.absPath ??
    folders.find((f) => /english/i.test(f.folderName))?.absPath ??
    folders[0]!.absPath
  );
};

/**
 * Build Final Cut zip entries: `{Ukrainian_Ukrainian_uk}/*.po` with overlays.
 */
export const collectDiscoPoPatchEntries = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  extractRootOverride?: string | null,
): Promise<ZipPackEntry[]> => {
  const extractRoot =
    extractRootOverride && extractRootOverride.length > 0
      ? extractRootOverride
      : resolveDiscoExtractRoot(modPath);

  const sourceLangDir = findSourceDiscoLangFolder(extractRoot);
  if (!sourceLangDir) {
    log.info(`Disco PO export: no source language folder for mod ${modId}`);
    return [];
  }

  const overlaysByFile = await getDiscoPoOverlaysByFile(db, modId, srcLang, targetLang);
  if (overlaysByFile.size === 0) {
    log.info(`Disco PO export: no PO translations for mod ${modId}`);
    return [];
  }

  const outFolder = discoLangFolderNameForLocale(targetLang);
  const entries: ZipPackEntry[] = [];
  let changedFiles = 0;

  for (const poPath of listPoFilesInDir(sourceLangDir)) {
    const relPo = path.relative(sourceLangDir, poPath).split(path.sep).join('/');
    const overlay = overlaysByFile.get(relPo);
    if (!overlay || overlay.size === 0) continue;

    const sourceBuf = fs.readFileSync(poPath);
    const compiled = writePoWithOverlays(sourceBuf, overlay);
    entries.push({
      name: `${outFolder}/${relPo}`,
      data: compiled,
    });
    changedFiles++;
  }

  if (changedFiles > 0) {
    log.info(`Disco PO export: prepared ${changedFiles} .po file(s) for mod ${modId}`);
  }
  return entries;
};
