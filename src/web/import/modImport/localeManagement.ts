import fs from 'node:fs';
import type { Tx } from '../../../db';
import { EspReader } from '../../../formats/esp';
import { resolveModDirectoryFromPath } from '../../../formats/mcm';
import { discoverLocaleSources } from '../modImportLocaleStream';
import type { GameType } from '../../../types';
import { getModImportJob, updateModJobLanguages } from './jobs';
import { isModImportRunning } from './activeJobs';
import { previewModRecords } from './preview';
import {
  MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
  isImportAllLocalesRequest,
  normalizeLocaleAlias,
  resolveAvailableLocale,
  resolveSingleImportLocale,
} from './localeHelpers';
import type { ModImportJob, ModImportLocaleInfo, ChangeModImportLocaleResult } from './types';
import { collectMcmLocalesForMod } from './mcmLocales';
import { discoverArchiveCandidatesForPlugin, isPluginPath } from './discovery';

/** Locale metadata for an import job — stored DB langs plus on-disk locales when available. */
export const getModImportLocaleInfo = async (
  db: Tx,
  jobId: number,
): Promise<ModImportLocaleInfo> => {
  const job = await getModImportJob(db, jobId);
  if (!job) throw new Error('Import job not found');

  let availableLocales: string[] = [];
  if (job.esp_path && fs.existsSync(job.esp_path)) {
    try {
      availableLocales = previewModRecords(job).locales;
    } catch {
      /* uploaded files may be missing or unreadable */
    }
  }

  let storedLangs: string[] = [];
  let stringCount = 0;
  if (job.mod_id != null) {
    const { rows } = await db.query<{ lang: string; cnt: string }>(
      `SELECT s.lang, COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1 AND s.lang IS NOT NULL
       GROUP BY s.lang
       ORDER BY COUNT(*) DESC`,
      [job.mod_id],
    );
    storedLangs = rows.map((row) => row.lang);
    stringCount = rows.reduce((sum, row) => sum + Number.parseInt(row.cnt, 10), 0);
  }

  return {
    jobId,
    modId: job.mod_id,
    currentSrcLang: job.src_lang,
    storedLangs,
    availableLocales,
    isLocalized: job.is_localized === 1,
    stringCount,
  };
};

export const changeModImportLocaleInDb = async (
  db: Tx,
  jobId: number,
  newSrcLang: string,
): Promise<ChangeModImportLocaleResult> => {
  const job = await getModImportJob(db, jobId);
  if (!job) throw new Error('Import job not found');
  if (isModImportRunning(jobId)) throw new Error('Cannot change locale while import is running');
  if (job.status !== 'completed')
    throw new Error('Locale can only be changed on completed imports');
  if (job.mod_id == null) throw new Error('Import has no associated mod');

  const newLang = newSrcLang.trim();
  if (!newLang) throw new Error('Locale is required');

  const { rows: langRows } = await db.query<{ lang: string }>(
    `SELECT DISTINCT s.lang
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND s.lang IS NOT NULL`,
    [job.mod_id],
  );
  const storedLangs = langRows.map((row) => row.lang);
  if (storedLangs.length === 0) {
    throw new Error('Mod has no imported strings to relabel');
  }

  const storedLookup = new Map(storedLangs.map((lang) => [lang, true]));
  const oldLangResolved =
    resolveAvailableLocale(storedLookup, job.src_lang)?.resolvedKey ??
    (storedLangs.length === 1 ? storedLangs[0]! : storedLangs[0]!);

  if (normalizeLocaleAlias(oldLangResolved) === normalizeLocaleAlias(newLang)) {
    throw new Error('New locale is the same as the current locale');
  }

  await db.query('BEGIN');
  try {
    const stringsResult = await db.query(
      `UPDATE strings s
       SET lang = $1
       FROM records r
       WHERE s.record_id = r.id
         AND r.mod_id = $2
         AND s.lang = $3`,
      [newLang, job.mod_id, oldLangResolved],
    );

    const translationsResult = await db.query(
      `UPDATE translations t
       SET target_lang = $1
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE t.src_string_id = s.id
         AND r.mod_id = $2
         AND t.target_lang = $3
         AND t.provenance = 'import_self_translation'`,
      [newLang, job.mod_id, oldLangResolved],
    );

    await updateModJobLanguages(db, jobId, newLang, job.tgt_lang);
    await db.query('COMMIT');

    return {
      modId: job.mod_id,
      jobId,
      oldLang: oldLangResolved,
      newLang,
      stringsUpdated: stringsResult.rowCount ?? 0,
      translationsUpdated: translationsResult.rowCount ?? 0,
    };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
};

export const validateModImportLocaleSelection = (
  job: ModImportJob,
  srcLang: string,
  importAllLocalizations: boolean,
): void => {
  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) {
    throw new Error('Import file not found on disk');
  }

  if (!isPluginPath(anchorPath)) {
    if (importAllLocalizations) return;

    const modDir = resolveModDirectoryFromPath(anchorPath);
    const mcmLocales = collectMcmLocalesForMod(modDir, anchorPath);
    if (mcmLocales.size === 0) return;

    if (!resolveAvailableLocale(mcmLocales, srcLang)) {
      const available = [...mcmLocales.keys()].sort().join(', ');
      throw new Error(`Locale "${srcLang}" not found. Available locales: ${available}`);
    }
    return;
  }

  const game: GameType = (job.game as GameType) ?? 'fo4';
  const esp = new EspReader(anchorPath, game);
  if (!esp.info.isLocalized) return;

  const localeSources = discoverLocaleSources(
    anchorPath,
    game,
    discoverArchiveCandidatesForPlugin(anchorPath),
  );
  if (localeSources.length === 0 || importAllLocalizations) return;

  const localeKeys = new Map(localeSources.map((s) => [s.locale, true]));
  if (!resolveSingleImportLocale(localeKeys, srcLang)) {
    const available = localeSources
      .map((s) => s.locale)
      .sort()
      .join(', ');
    throw new Error(`Locale "${srcLang}" not found in mod files. Available locales: ${available}`);
  }
};
