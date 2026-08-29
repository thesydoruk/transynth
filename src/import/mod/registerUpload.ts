/**
 * Registration step for uploaded plugin/archive files: hashes the upload and
 * creates (or resumes) the `mod_imports` job row. The import itself runs in the
 * worker.
 */
import crypto from 'node:crypto';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { modImportExtractDir } from '../../modStorage';
import { isArchive, isPlugin } from './discovery';
import { registerArchiveFile, registerPluginFile } from './registration';
import type { ModImportJob, ModScanContext } from './types';

export type RegisterUploadedModOptions = {
  fileName: string;
  storedPath: string;
  srcLang: string;
  tgtLang: string;
  game?: GameType;
  scan?: ModScanContext;
};

/** Register a mod file already stored under MOD_UPLOAD_DIR. */
export const registerUploadedModFile = async (
  db: Tx,
  options: RegisterUploadedModOptions,
): Promise<ModImportJob> => {
  const { fileName, storedPath, srcLang, tgtLang, game = 'fo4', scan } = options;

  if (isPlugin(fileName)) {
    return registerPluginFile(db, fileName, storedPath, srcLang, tgtLang, game, scan);
  }
  if (isArchive(fileName)) {
    const hash = crypto.randomBytes(8).toString('hex');
    const outDir = modImportExtractDir(hash);
    return registerArchiveFile(db, fileName, storedPath, outDir, srcLang, tgtLang, game, scan);
  }

  throw new Error('Only .esp/.esm/.esl plugin files or .zip/.7z/.rar archives are accepted');
};
