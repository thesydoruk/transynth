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
  parsePoBuffer,
  poEntryKey,
  writePoWithOverlays,
} from '../../formats/po';
import { log } from '../../logger';
import { resolveDiscoExtractRoot } from '../../import/mod/discoPoLocales';
import { hashDiscoMsgid, isHashedDiscoEntryKey } from '../../import/mod/discoPoPath';
import { discoPoSignatureSqlValues } from '../../import/mod/discoPoSignature';
import type { ZipPackEntry } from './exportTypes';

/**
 * Map hashed DB overlay keys (`msgctxt::#sha1`) back to full gettext entry keys
 * so `writePoWithOverlays` can match source `.po` entries.
 */
const expandHashedDiscoOverlays = (
  sourcePo: Buffer,
  overlays: Map<string, string>,
): Map<string, string> => {
  const out = new Map<string, string>();
  let hasHashed = false;
  for (const [key, text] of overlays) {
    if (isHashedDiscoEntryKey(key)) hasHashed = true;
    else out.set(key, text);
  }
  if (!hasHashed) return out;

  for (const entry of parsePoBuffer(sourcePo)) {
    const fullKey = poEntryKey(entry.msgctxt, entry.msgid);
    const hashedKey = poEntryKey(entry.msgctxt, `#${hashDiscoMsgid(entry.msgid)}`);
    const text = overlays.get(fullKey) ?? overlays.get(hashedKey);
    if (text != null) out.set(fullKey, text);
  }
  return out;
};

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
     WHERE r.mod_id = $1 AND r.signature = ANY($4::text[])`,
    [modId, srcLang, targetLang, discoPoSignatureSqlValues()],
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
    const compiled = writePoWithOverlays(sourceBuf, expandHashedDiscoOverlays(sourceBuf, overlay));
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
