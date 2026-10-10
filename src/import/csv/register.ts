import { upsertMod, type Tx } from '../../db';
import type { GameId } from '../../types';
import { sha1Hex } from '../../utils/hash';
import { getOrCreateJob } from './jobs';
import { parseCsvRecords } from './parse';
import type { CsvImportJob } from './types';

/**
 * Register an uploaded CSV file by creating (or reusing) an import job row.
 *
 * This does not perform the import. Call {@link runCsvImport} to execute the
 * actual ingestion.
 *
 * `game` has no default: a CSV carries no game of its own, and a fallback here
 * once filed every upload under Fallout 4. Uploading the same file again files
 * its mod under the game given this time.
 */
export const registerCsvFile = async (
  db: Tx,
  fileName: string,
  text: string,
  { game, srcLang = 'en', tgtLang = 'uk' }: { game: GameId; srcLang?: string; tgtLang?: string },
): Promise<CsvImportJob> => {
  const fileHash = sha1Hex(Buffer.from(text, 'utf8'));
  const records = parseCsvRecords(text);
  const totalRecords = records.length;

  const modName = fileName.replace(/\.csv$/i, '');
  const modId = await upsertMod(db, modName, `csv-upload/${fileName}`, fileHash, game);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
};
