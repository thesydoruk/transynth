/**
 * Promote the locales of backfilled records into translations.
 *
 * Same contract as the finalize phase of a full import, but every statement is
 * scoped to the freshly inserted record ids: translations of records that were
 * already in the database — machine, reviewed or hand-written — must survive.
 */
import type { Tx } from '../../db';
import { sqlConvertImportedStringsToTranslations } from '../bulk';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE, resolveAvailableLocale } from '../mod/localeHelpers';
import type { BackfillLocalePlan } from './localePlan';

export type BackfillTranslationResult = {
  sourceLocale: string | null;
  inserted: number;
  deletedNonSourceStrings: number;
};

const EMPTY: BackfillTranslationResult = {
  sourceLocale: null,
  inserted: 0,
  deletedNonSourceStrings: 0,
};

const localesOfRecords = async (db: Tx, recordIds: number[]): Promise<string[]> => {
  const { rows } = await db.query<{ lang: string }>(
    'SELECT DISTINCT lang FROM strings WHERE record_id = ANY($1::int[]) AND lang IS NOT NULL',
    [recordIds],
  );
  return rows.map((row) => row.lang).filter(Boolean);
};

export const convertBackfilledRecords = async (
  db: Tx,
  modId: number,
  plan: BackfillLocalePlan,
  isLocalized: boolean,
  recordIds: number[],
): Promise<BackfillTranslationResult> => {
  if (recordIds.length === 0) return EMPTY;

  const localizedAllLocales =
    isLocalized && !plan.singleLocaleMode && plan.localeSources.length > 0;
  const inlineStrings = !isLocalized || plan.localeSources.length === 0;
  // Single-locale imports store one language and never build self-translations.
  if (!localizedAllLocales && !inlineStrings) return EMPTY;

  const locales = await localesOfRecords(db, recordIds);
  if (locales.length === 0) return EMPTY;

  const srcLang = localizedAllLocales ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE : plan.pluginStringLang;
  const lookup = new Map(locales.map((locale) => [locale, true]));
  const sourceLocale =
    resolveAvailableLocale(lookup, srcLang)?.resolvedKey ??
    resolveAvailableLocale(lookup, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)?.resolvedKey ??
    [...locales].sort()[0];

  const { inserted } = await sqlConvertImportedStringsToTranslations(
    db,
    modId,
    sourceLocale,
    recordIds,
  );

  let deletedNonSourceStrings = 0;
  if (localizedAllLocales) {
    const { rowCount } = await db.query(
      'DELETE FROM strings WHERE record_id = ANY($1::int[]) AND lang <> $2',
      [recordIds, sourceLocale],
    );
    deletedNonSourceStrings = rowCount ?? 0;
  }

  return { sourceLocale, inserted, deletedNonSourceStrings };
};
