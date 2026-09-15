/**
 * Registration step for uploaded files: hash the upload and create (or resume)
 * the `mod_imports` job row. The import itself runs in the worker.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type { Tx } from '../../db';
import { DEFAULT_GAME_ID, gamePlugin } from '../../games/registry';
import type { GameId } from '../../types';
import { modImportExtractDir } from '../../modStorage';
import { isArchive } from './discovery';
import { registerArchiveFile, registerPluginFile } from './registration';
import type { ModImportJob, ModScanContext } from './types';

export type RegisterUploadedModOptions = {
  fileName: string;
  storedPath: string;
  srcLang: string;
  tgtLang: string;
  game?: GameId;
  scan?: ModScanContext;
};

/** Register a mod file already stored under MOD_UPLOAD_DIR. */
export const registerUploadedModFile = async (
  db: Tx,
  options: RegisterUploadedModOptions,
): Promise<ModImportJob> => {
  const { fileName, storedPath, srcLang, tgtLang, game = DEFAULT_GAME_ID, scan } = options;
  const { uploadExtensions } = gamePlugin(game).import;
  const extension = path.extname(fileName).toLowerCase();

  if (uploadExtensions.includes(extension)) {
    return registerPluginFile(db, fileName, storedPath, srcLang, tgtLang, game, scan);
  }
  if (isArchive(fileName)) {
    const hash = crypto.randomBytes(8).toString('hex');
    const outDir = modImportExtractDir(hash);
    return registerArchiveFile(db, fileName, storedPath, outDir, srcLang, tgtLang, game, scan);
  }

  const accepted = [...uploadExtensions, '.zip', '.7z', '.rar'].join(', ');
  throw new Error(`Unsupported upload for ${game}. Accepted: ${accepted}`);
};
