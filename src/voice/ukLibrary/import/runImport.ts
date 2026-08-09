import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { ensureDir } from '../../../utils/file';
import { PATHS } from '../../../paths';
import { importCommonVoiceVoices, type ImportCommonVoiceOptions } from './commonVoice';
import { importOpenttsVoices } from './opentts';

export type UkVoiceLibraryImportResult = {
  opentts: number;
  commonVoice: number;
};

/** Download opentts + Common Voice reference clips into the local library. */
export const runUkVoiceLibraryImport = async (
  db: Tx,
  options: ImportCommonVoiceOptions = {},
): Promise<UkVoiceLibraryImportResult> => {
  ensureDir(PATHS.ukVoiceLibrary);
  log.info(`Importing Ukrainian voice library → ${PATHS.ukVoiceLibrary}`);
  const opentts = await importOpenttsVoices(db);
  const commonVoice = await importCommonVoiceVoices(db, options);
  return { opentts, commonVoice };
};
