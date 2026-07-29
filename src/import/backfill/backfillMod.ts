/**
 * Re-scan one mod's plugin and import only the records it is missing.
 *
 * Unlike a full re-import this never prunes and never touches rows that are
 * already stored, so it is safe to run on mods that have been translated. It is
 * the migration path for changes to the translatable-subrecord configuration:
 * enabling a new record type adds those strings without a 1M-row re-import.
 *
 * Scope: plugin (ESP/ESM/ESL) strings only. MCM and PEX extras, the dialog
 * graph and scene tables are left to a full import.
 */
import type { Tx } from '../../db';
import { EspReader, type EspStringRow } from '../../formats/esp';
import { loadNpcReferenceMap } from '../../formats/subrecords';
import { logImport } from '../../logging/loggers';
import type { CsvRow } from '../../types';
import { bulkInsertModImportRows, type ModImportBulkRow } from '../bulk';
import { chunk } from '../bulk/chunk';
import {
  generateImportCsvRows,
  loadLocaleStringsByType,
  resolveEnglishLocaleMaps,
  resolveEnglishLocaleSource,
  type LocaleStringsMaps,
} from '../mod/localeRows';
import { localeSourcesByLocale } from '../mod/localeSources';
import { buildNpcNameMap, buildSpeakerFormIdMap } from '../mod/speakerMaps';
import { resolveBackfillLocalePlan, type BackfillLocalePlan } from './localePlan';
import {
  countRecordsBySignature,
  loadExistingRecordKeys,
  selectMissingEspRows,
} from './missingRows';
import { convertBackfilledRecords } from './translationScope';
import type { BackfillTarget } from './targets';

/** Record types whose relationships live in the dialog graph, not just `strings`. */
const DIALOG_SIGNATURES = new Set(['INFO', 'DIAL', 'SCEN', 'QUST']);

export type BackfillModResult = {
  modId: number;
  modName: string;
  missingRecords: number;
  bySignature: Array<{ signature: string; records: number }>;
  /** Missing records that a full re-import would also link into the dialog graph. */
  dialogRecords: number;
  insertedStrings: number;
  insertedTranslations: number;
  locales: string[];
};

/** Locale used to decide which missing records actually carry text. */
const countingLocale = (plan: BackfillLocalePlan): string | null => {
  if (plan.locales.length === 0) return null;
  const english = resolveEnglishLocaleSource(plan.localeSources)?.locale;
  return plan.locales.find((locale) => locale === english) ?? plan.locales[0]!;
};

const buildContextResolver = (
  espRows: EspStringRow[],
  missingRows: EspStringRow[],
  target: BackfillTarget,
  localeSources: ReturnType<typeof resolveBackfillLocalePlan>['localeSources'],
): ((row: CsvRow) => string | null) => {
  const speakerMap = buildSpeakerFormIdMap(espRows);
  const hasSpeakers = missingRows.some(
    (row) => row.speakerFormId != null || speakerMap.has(row.formId),
  );
  if (!hasSpeakers) return () => null;

  const npcRefMap = loadNpcReferenceMap(target.game);
  const npcNameFromMod = buildNpcNameMap(
    espRows,
    resolveEnglishLocaleMaps(localeSources)?.get('STRINGS') ?? null,
  );
  return (row) => {
    const speakerFormId = row.SpeakerFormID ?? speakerMap.get(row.FormID ?? '');
    if (!speakerFormId) return null;
    return npcNameFromMod.get(speakerFormId) ?? npcRefMap.get(speakerFormId) ?? null;
  };
};

export const backfillModStrings = async (
  db: Tx,
  target: BackfillTarget,
  opts: { dryRun: boolean; chunkSize: number },
): Promise<BackfillModResult> => {
  const esp = new EspReader(target.espPath, target.game);
  const espRows = esp.extractStrings();
  const existingKeys = await loadExistingRecordKeys(db, target.modId);
  const missingRows = selectMissingEspRows(espRows, existingKeys);
  const plan = resolveBackfillLocalePlan(esp, target.espPath, target.game, target.srcLang);
  const catalog = localeSourcesByLocale(plan.localeSources);

  const anchorLocale = countingLocale(plan);
  const anchorMaps: LocaleStringsMaps | null =
    anchorLocale && missingRows.length > 0
      ? loadLocaleStringsByType(catalog.get(anchorLocale)!)
      : null;
  const bySignature = countRecordsBySignature([
    ...generateImportCsvRows(missingRows, anchorMaps, target.game),
  ]);

  const result: BackfillModResult = {
    modId: target.modId,
    modName: target.modName,
    missingRecords: bySignature.reduce((sum, entry) => sum + entry.records, 0),
    bySignature,
    dialogRecords: bySignature
      .filter((entry) => DIALOG_SIGNATURES.has(entry.signature))
      .reduce((sum, entry) => sum + entry.records, 0),
    insertedStrings: 0,
    insertedTranslations: 0,
    locales: [],
  };

  if (result.missingRecords === 0 || opts.dryRun) return result;

  result.locales = plan.locales.length > 0 ? plan.locales : [plan.pluginStringLang];
  const resolveContext = buildContextResolver(espRows, missingRows, target, plan.localeSources);
  const recordIds = new Set<number>();

  const writeRows = async (rows: ModImportBulkRow[]): Promise<void> => {
    for (const part of chunk(rows, opts.chunkSize)) {
      const results = await bulkInsertModImportRows(db, target.modId, part);
      for (const item of results) recordIds.add(item.recordId);
      result.insertedStrings += results.length;
    }
  };

  const rowsForLocale = (locale: string, maps: LocaleStringsMaps | null) =>
    [...generateImportCsvRows(missingRows, maps, target.game)].map(
      (csvRow): ModImportBulkRow => ({
        csvRow,
        locale,
        context: resolveContext(csvRow),
        sourceKind: 'mod-import',
      }),
    );

  await db.query('BEGIN');
  try {
    if (plan.locales.length > 0) {
      for (const locale of plan.locales) {
        const maps =
          locale === anchorLocale ? anchorMaps : loadLocaleStringsByType(catalog.get(locale)!);
        await writeRows(rowsForLocale(locale, maps));
      }
    } else {
      await writeRows(rowsForLocale(plan.pluginStringLang, null));
    }

    const translations = await convertBackfilledRecords(
      db,
      target.modId,
      plan,
      target.isLocalized,
      [...recordIds],
    );
    result.insertedTranslations = translations.inserted;
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    logImport.error(
      `[Backfill] mod ${target.modId} "${target.modName}" failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  return result;
};
