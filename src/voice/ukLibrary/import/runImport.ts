import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { ensureDir } from '../../../utils/file';
import { PATHS } from '../../../paths';
import { clearAllCharacterUkVoiceLinks, deleteUkVoicesNotIn, listUkVoiceLibrary } from '../db';
import { importCommonVoiceVoices, type ImportCommonVoiceOptions } from './commonVoice';
import { importOpenttsVoices } from './opentts';

export type UkVoiceLibraryImportResult = {
  opentts: number;
  commonVoice: number;
  removedObsolete: number;
};

/**
 * Select best-reference winners from the full corpus cache into uk_voice_library.
 * Clears character links and drops obsolete library rows (old cv:rowIdx ids).
 */
export const runUkVoiceLibraryImport = async (
  db: Tx,
  options: ImportCommonVoiceOptions = {},
): Promise<UkVoiceLibraryImportResult> => {
  ensureDir(PATHS.ukVoiceLibrary);
  ensureDir(PATHS.ukVoiceCache);
  log.info(`Selecting UK voice library winners → ${PATHS.ukVoiceLibrary}`);

  await clearAllCharacterUkVoiceLinks(db);

  const opentts = await importOpenttsVoices(db);
  const commonVoice = await importCommonVoiceVoices(db, options);

  const keepIds = (await listUkVoiceLibrary(db)).map((voice) => voice.id);
  const removedObsolete = await deleteUkVoicesNotIn(db, keepIds);
  log.info(
    `UK library import done: opentts=${opentts}, commonVoice=${commonVoice}, removed=${removedObsolete}`,
  );
  return { opentts, commonVoice, removedObsolete };
};
