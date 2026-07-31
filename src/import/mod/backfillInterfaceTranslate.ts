import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { resolveModDirectoryFromPath } from '../../formats/mcm';
import { bulkInsertModImportRows } from '../bulk';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from './localeHelpers';
import {
  buildInterfaceTranslateCsvRows,
  collectInterfaceTranslateLocales,
} from './interfaceTranslate';
import type { GameType } from '../../types';

export type BackfillInterfaceTranslateOptions = {
  dryRun?: boolean;
  srcLang?: string;
  importLocaleTranslations?: boolean;
};

export type BackfillInterfaceTranslateResult = {
  modId: number;
  sourceLocale: string;
  insertedRecords: number;
  insertedStrings: number;
  insertedTranslations: number;
  skippedExisting: number;
};

const bulkInsertTranslationsIfMissing = async (
  db: Tx,
  items: Array<{ srcStringId: number; text: string }>,
  targetLang: string,
): Promise<number> => {
  if (items.length === 0) return 0;
  let total = 0;
  const batchSize = CONFIG.dbChunkSize;
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const stringIds = slice.map((item) => item.srcStringId);
    const texts = slice.map((item) => item.text);
    const { rowCount } = await db.query(
      `INSERT INTO translations(
         src_string_id, target_lang, text, status, confidence, provenance, updated_at
       )
       SELECT s, $2, t, 'reviewed', 1.0, 'interface-backfill', NOW()
       FROM UNNEST($1::int[], $3::text[]) AS u(s, t)
       ON CONFLICT (src_string_id, target_lang) DO NOTHING`,
      [stringIds, targetLang, texts],
    );
    total += rowCount ?? 0;
  }
  return total;
};

/** Add missing Interface/Translate UI source rows without touching existing translations. */
export const backfillModInterfaceTranslate = async (
  db: Tx,
  modId: number,
  modPath: string,
  game: GameType,
  options: BackfillInterfaceTranslateOptions = {},
): Promise<BackfillInterfaceTranslateResult | null> => {
  const modDir = resolveModDirectoryFromPath(modPath);
  const locales = collectInterfaceTranslateLocales(modDir, modPath, game);
  const sourceLocale =
    (options.srcLang && locales.has(options.srcLang) ? options.srcLang : null) ??
    (locales.has(MOD_IMPORT_DEFAULT_SOURCE_LOCALE) ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE : null) ??
    [...locales.keys()][0];

  if (!sourceLocale) return null;

  const sourceMap = locales.get(sourceLocale);
  if (!sourceMap || sourceMap.size === 0) return null;

  const rows = buildInterfaceTranslateCsvRows(sourceLocale, sourceMap);
  const { rows: existingRows } = await db.query<{ path: string }>(
    `SELECT path FROM records WHERE mod_id = $1 AND signature = 'UI'`,
    [modId],
  );
  const existingPaths = new Set(existingRows.map((row) => row.path));
  const missingRows = rows.filter((row) => !existingPaths.has(row.Path));
  const srcLang = options.srcLang ?? MOD_IMPORT_DEFAULT_SOURCE_LOCALE;

  if (options.dryRun) {
    return {
      modId,
      sourceLocale,
      insertedRecords: missingRows.length,
      insertedStrings: missingRows.length,
      insertedTranslations: 0,
      skippedExisting: rows.length - missingRows.length,
    };
  }

  const sourceStringIdByKey = new Map<string, number>();
  let insertedStrings = 0;

  for (let i = 0; i < missingRows.length; i += CONFIG.dbChunkSize) {
    await db.query('BEGIN');
    const slice = missingRows.slice(i, i + CONFIG.dbChunkSize);
    const results = await bulkInsertModImportRows(
      db,
      modId,
      slice.map((csvRow) => ({
        csvRow,
        locale: srcLang,
        context: null,
        sourceKind: 'interface',
      })),
    );
    for (const res of results) {
      const key = res.row.csvRow.Path.split('\\').pop() ?? '';
      sourceStringIdByKey.set(key, res.stringId);
    }
    insertedStrings += results.length;
    await db.query('COMMIT');
  }

  if (existingRows.length > 0) {
    const { rows: existingUiRows } = await db.query<{ path: string; string_id: number }>(
      `SELECT r.path, s.id AS string_id
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1 AND r.signature = 'UI'`,
      [modId, srcLang],
    );
    for (const row of existingUiRows) {
      const key = row.path.split('\\').pop() ?? '';
      if (key) sourceStringIdByKey.set(key, row.string_id);
    }
  }

  let insertedTranslations = 0;
  if (options.importLocaleTranslations !== false) {
    for (const [locale, translateMap] of locales) {
      if (locale === sourceLocale) continue;
      const items: Array<{ srcStringId: number; text: string }> = [];
      for (const [key, text] of translateMap) {
        const sourceStringId = sourceStringIdByKey.get(key);
        if (!sourceStringId) continue;
        items.push({ srcStringId: sourceStringId, text });
      }
      insertedTranslations += await bulkInsertTranslationsIfMissing(db, items, locale);
    }
  }

  return {
    modId,
    sourceLocale,
    insertedRecords: missingRows.length,
    insertedStrings,
    insertedTranslations,
    skippedExisting: rows.length - missingRows.length,
  };
};

export const listModsNeedingInterfaceTranslateBackfill = async (
  db: Tx,
  modId?: number,
): Promise<Array<{ id: number; name: string; abs_path: string; game: GameType }>> => {
  const params: unknown[] = [];
  const filters = [`m.abs_path IS NOT NULL`];
  if (modId != null) {
    params.push(modId);
    filters.push(`m.id = $${params.length}`);
  } else {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM records r WHERE r.mod_id = m.id AND r.signature = 'UI' LIMIT 1
    )`);
  }

  const { rows } = await db.query<{
    id: number;
    name: string;
    abs_path: string;
    game: GameType | null;
  }>(
    `SELECT m.id, m.name, m.abs_path, COALESCE(m.game, 'fo4') AS game
     FROM mods m
     WHERE ${filters.join(' AND ')}
     ORDER BY m.id`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    abs_path: row.abs_path,
    game: (row.game ?? 'fo4') as GameType,
  }));
};
