import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { ensureDir } from '../../../utils/file';
import { PATHS } from '../../../paths';
import {
  clearAllCharacterUkVoiceLinks,
  deleteUkVoicesNotIn,
  deleteUkVoicesWithBadTranscripts,
} from '../db';
import { importCommonVoiceVoices, type ImportCommonVoiceOptions } from './commonVoice';
import { importOpenttsVoices } from './opentts';

export type UkVoiceLibraryImportResult = {
  opentts: number;
  commonVoice: number;
  removedObsolete: number;
  removedBadTranscripts: number;
};

/**
 * Select best-reference winners from the full corpus cache into uk_voice_library.
 * Clears character links and drops obsolete library rows not written this run.
 */
export const runUkVoiceLibraryImport = async (
  db: Tx,
  options: ImportCommonVoiceOptions = {},
): Promise<UkVoiceLibraryImportResult> => {
  ensureDir(PATHS.ukVoiceLibrary);
  ensureDir(PATHS.ukVoiceCache);
  log.info(`Selecting UK voice library winners → ${PATHS.ukVoiceLibrary}`);

  await clearAllCharacterUkVoiceLinks(db);
  const removedBadTranscripts = await deleteUkVoicesWithBadTranscripts(db);

  const openttsResult = await importOpenttsVoices(db);
  const commonVoiceResult = await importCommonVoiceVoices(db, options);

  const keepIds = [...openttsResult.ids, ...commonVoiceResult.ids];
  const removedObsolete = await deleteUkVoicesNotIn(db, keepIds);
  log.info(
    `UK library import done: opentts=${openttsResult.count}, commonVoice=${commonVoiceResult.count}, removedObsolete=${removedObsolete}, removedBadTranscripts=${removedBadTranscripts}`,
  );
  return {
    opentts: openttsResult.count,
    commonVoice: commonVoiceResult.count,
    removedObsolete,
    removedBadTranscripts,
  };
};
