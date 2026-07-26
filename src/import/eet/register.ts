/**
 * Registration step for uploaded EET files.
 *
 * EET files are produced by ESP-ESM Translator and contain per-record source and
 * target strings. Registration only creates the mod row and the job row; the
 * ingestion itself runs in the worker (`jobs/import/eet`).
 */
import { parseEetHeader, iterEetRecords } from '../../formats/eet';
import { upsertMod, type Tx } from '../../db';
import { sha1Hex } from '../../utils/hash';
import { getOrCreateJob, type ImportJob } from './jobs';

/**
 * Register an uploaded EET file by creating (or reusing) an import job row.
 *
 * When the header does not declare a record count the records are streamed once
 * to count them, so the UI can show a total before the import starts.
 *
 * @param db - Database handle.
 * @param fileName - Original uploaded file name (used for display/mod naming).
 * @param buf - Raw EET file contents.
 * @param srcLang - Source language code for ingested strings.
 * @param tgtLang - Target language code for ingested translations.
 * @returns Created or existing job descriptor.
 */
export const registerEetFile = async (
  db: Tx,
  fileName: string,
  buf: Buffer,
  srcLang = 'en',
  tgtLang = 'uk',
): Promise<ImportJob> => {
  const fileHash = sha1Hex(buf);
  const header = parseEetHeader(buf);

  let totalRecords = header.declaredCount;
  if (totalRecords < 0) {
    let count = 0;
    for (const _ of iterEetRecords(buf, header.recordsOffset)) count++;
    totalRecords = count;
  }

  const modName = fileName.replace(/\.eet$/i, '');
  const modId = await upsertMod(db, modName, `eet-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
};
