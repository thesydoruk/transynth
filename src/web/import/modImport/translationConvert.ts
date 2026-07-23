import type { Tx } from '../../../db';
import { logImport } from '../../../logging/loggers';
import { sqlConvertImportedStringsToTranslations } from '../modImportBulk';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE, resolveAvailableLocale } from './localeHelpers';

export const convertImportedStringsToTranslations = async (
  db: Tx,
  modId: number,
  srcLang = 'en',
  isLocalized = false,
): Promise<void> => {
  try {
    const localesResult = await db.query<{ lang: string }>(
      `SELECT DISTINCT s.lang
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1 AND s.lang IS NOT NULL`,
      [modId],
    );
    const locales = localesResult.rows.map((r) => r.lang).filter(Boolean);
    if (locales.length === 0) {
      logImport.info(`[ModImport] No strings found for mod ${modId}; skipping conversion`);
      return;
    }

    const localeLookup = new Map(locales.map((locale) => [locale, true]));
    const resolvedSourceLocale =
      resolveAvailableLocale(localeLookup, srcLang)?.resolvedKey ??
      resolveAvailableLocale(localeLookup, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)?.resolvedKey ??
      locales.sort()[0];

    logImport.info(
      `[ModImport] Converting ${locales.length} locale(s) (${locales.join(', ')}) to translations for mod ${modId}; ` +
        `resolved src locale="${resolvedSourceLocale}"` +
        (isLocalized ? ' [localized]' : ' [non-localized]'),
    );

    const { inserted, skippedWithoutSource } = await sqlConvertImportedStringsToTranslations(
      db,
      modId,
      resolvedSourceLocale,
    );

    logImport.info(
      `[ModImport] Created ${inserted} import translations via SQL alignment` +
        (skippedWithoutSource > 0
          ? `; skipped ${skippedWithoutSource} target rows without source pair`
          : ''),
    );

    // After all translations created, delete non-source strings only for localized mods
    // For non-localized mods, keep the source strings alongside their self-translations
    if (isLocalized && srcLang) {
      const deleteNonSrcResult = await db.query(
        `DELETE FROM strings s
         USING records r
         WHERE s.record_id = r.id AND r.mod_id = $1 AND s.lang != $2`,
        [modId, resolvedSourceLocale],
      );
      logImport.info(
        `[ModImport] Deleted ${deleteNonSrcResult.rowCount} non-source language strings (kept ${resolvedSourceLocale})`,
      );
    }
  } catch (err) {
    logImport.error(
      `[ModImport] Error converting ${
        isLocalized ? 'localized' : 'non-localized'
      } strings to translations: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
};
