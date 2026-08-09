import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { ensureDir } from '../../../utils/file';
import { PATHS } from '../../../paths';
import {
  clearAllCharacterUkVoiceLinks,
  deleteUkVoicesNotIn,
  deleteUkVoicesWithBadTranscripts,
  listUkVoiceLibrary,
} from '../db';
import { importCommonVoiceVoices, type ImportCommonVoiceOptions } from './commonVoice';
import { importOpenttsVoices } from './opentts';
import { pruneOrphanUkVoiceLibraryFiles } from './pruneLibraryFiles';

export type UkVoiceLibraryImportResult = {
  opentts: number;
  commonVoice: number;
  removedObsolete: number;
  removedBadTranscripts: number;
  prunedOrphanFiles: number;
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
  const keepRels = (await listUkVoiceLibrary(db)).map((voice) => voice.audioRelPath);
  const prunedOrphanFiles = pruneOrphanUkVoiceLibraryFiles(keepRels);
  log.info(
    `UK library import done: opentts=${openttsResult.count}, commonVoice=${commonVoiceResult.count}, removedObsolete=${removedObsolete}, removedBadTranscripts=${removedBadTranscripts}, prunedOrphanFiles=${prunedOrphanFiles}`,
  );
  return {
    opentts: openttsResult.count,
    commonVoice: commonVoiceResult.count,
    removedObsolete,
    removedBadTranscripts,
    prunedOrphanFiles,
  };
};
