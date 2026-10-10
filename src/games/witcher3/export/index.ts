/**
 * The Witcher 3 export.
 *
 * For every `content` folder the mod imported, write the target language's
 * `.w3strings` table back into the same folder: the translated text of every
 * line that has one, and otherwise what the table already said — the game's
 * own target-language text when the upload carries that table, the source
 * text when it does not (a table missing an id shows the player an empty
 * line, an untranslated one shows English). Nothing else in a mod changes, so
 * a full-mod export is the same payload as a langpack: the player drops it
 * over the game or mod folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { resolveModImportExtractRoot } from '../../../modStorage/paths';
import { packFilesToZip } from '../../../web/export/zipPack';
import type { ZipPackEntry } from '../../../web/export/exportTypes';
import type { GameExportAdapter, ModExportContext } from '../../contract';
import { listW3StringsFiles, resolveW3SourceLang, w3SlotForTargetLang } from '../packLayout';
import { W3_RECORD_SIGNATURES, w3RecordPath } from '../import/tables';
import { decodeW3Strings, encodeW3Strings, type W3StringsEntry } from '../w3strings';

const EMPTY_MESSAGE =
  'No exportable Witcher 3 strings — nothing imported from .w3strings tables yet.';

/** Translated text per record path; lines without a translation are absent. */
const loadTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<Map<string, string>> => {
  const { rows } = await db.query<{ path: string; text: string }>(
    `SELECT r.path, t.text
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1 AND r.signature = ANY($4::text[]) AND t.text IS NOT NULL`,
    [modId, srcLang, targetLang, [...W3_RECORD_SIGNATURES]],
  );
  return new Map(rows.map((row) => [row.path, row.text]));
};

const collectWitcher3LangpackEntries = async ({
  db,
  modId,
  modPath,
  srcLang,
  targetLang,
}: ModExportContext): Promise<ZipPackEntry[]> => {
  const extractRoot = resolveModImportExtractRoot(modPath) ?? path.dirname(modPath);
  if (!fs.existsSync(extractRoot)) {
    log.info(`Witcher 3 export: extract tree missing for mod ${modId} (${extractRoot})`);
    return [];
  }

  const files = listW3StringsFiles(extractRoot);
  const sourceLang = resolveW3SourceLang(files, 'en');
  if (!sourceLang) return [];

  const translations = await loadTranslations(db, modId, srcLang, targetLang);
  if (translations.size === 0) {
    log.info(`Witcher 3 export: no ${targetLang} translations for mod ${modId}`);
    return [];
  }

  // Each table is rebuilt from files, not from the database, so ids the import
  // skipped (empty strings) and every key hash come through exactly. When the
  // upload already has a table in the target slot — the Remastered game ships
  // `ua` — that table is the base: it can hold ids the source lacks (913 in
  // `content0/ua`, 56 of them UI keys), and dropping them would leave the game
  // showing raw keys. Source ids it lacks are appended.
  const slot = w3SlotForTargetLang(targetLang);
  const entries: ZipPackEntry[] = [];
  let total = 0;
  let replaced = 0;
  for (const file of files) {
    if (file.lang !== sourceLang) continue;
    const source = decodeW3Strings(fs.readFileSync(file.absPath));
    const existing = files.find((f) => f.lang === slot && f.contentDir === file.contentDir);
    const base = existing ? decodeW3Strings(fs.readFileSync(existing.absPath)) : null;
    const withTranslation = (entry: W3StringsEntry): W3StringsEntry => {
      const text = translations.get(w3RecordPath(file.contentDir, entry.id));
      if (text === undefined) return entry;
      replaced++;
      return { ...entry, text };
    };
    const baseIds = new Set(base?.entries.map((entry) => entry.id));
    const table = [
      ...(base?.entries ?? []).map(withTranslation),
      ...source.entries.filter((entry) => !baseIds.has(entry.id)).map(withTranslation),
    ];
    total += table.length;
    const layout = base ?? source;
    const name = file.contentDir ? `${file.contentDir}/${slot}.w3strings` : `${slot}.w3strings`;
    // Same format version as the game it patches: Remastered reads only UTF-8.
    entries.push({
      name,
      data: encodeW3Strings(table, slot, {
        version: layout.version,
        foreignKeys: layout.foreignKeys,
      }),
    });
  }
  log.info(
    `Witcher 3 export: ${entries.length} table(s) as "${slot}" for mod ${modId}, ` +
      `${replaced}/${total} strings from translations`,
  );
  return entries;
};

export const witcher3ExportAdapter: GameExportAdapter = {
  collectLangpackEntries: collectWitcher3LangpackEntries,
  emptyLangpackMessage: EMPTY_MESSAGE,
  logLabel: 'Witcher 3 langpack',

  exportFullModZip: async (ctx) => {
    const files = await collectWitcher3LangpackEntries(ctx);
    if (files.length === 0) throw new Error(EMPTY_MESSAGE);
    const stem = path.basename(ctx.modPath, path.extname(ctx.modPath));
    const zipBuffer = await packFilesToZip(files);
    return { zipBuffer, zipFileName: `${stem}_${ctx.targetLang}.zip` };
  },
};
