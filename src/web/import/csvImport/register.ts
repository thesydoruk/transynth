import { upsertMod, type Tx } from '../../../db';
import { sha1Hex } from '../../../utils/hash';
import { getOrCreateJob } from './jobs';
import { parseCsvRecords } from './parse';
import type { CsvImportJob } from './types';

/**
 * Register an uploaded CSV file by creating (or reusing) an import job row.
 *
 * This does not perform the import. Call {@link runCsvImport} to execute the
 * actual ingestion.
 */
export const registerCsvFile = async (
  db: Tx,
  fileName: string,
  text: string,
  srcLang = 'en',
  tgtLang = 'uk',
): Promise<CsvImportJob> => {
  const fileHash = sha1Hex(Buffer.from(text, 'utf8'));
  const records = parseCsvRecords(text);
  const totalRecords = records.length;

  const modName = fileName.replace(/\.csv$/i, '');
  const modId = await upsertMod(db, modName, `csv-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
};
