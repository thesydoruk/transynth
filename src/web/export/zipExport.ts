import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { DEFAULT_GAME_ID, gamePlugin } from '../../games/registry';
import type { GameId } from '../../types';
import { log } from '../../logger';
import { packFilesToZip } from './zipPack';

/**
 * Build a langpack ZIP: only the files a player who already owns the mod needs.
 *
 * The contents come from the game's export adapter; this function owns the
 * parts that are the same everywhere — the ZIP name, the scratch directory a
 * game may repack into, and the "nothing to export" error.
 */
export const exportLangpackZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameId = DEFAULT_GAME_ID,
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const exporter = gamePlugin(game).export;
  const stem = path.basename(modPath, path.extname(modPath));
  const zipFileName = `${stem}_${targetLang}_langpack.zip`;

  const files = await exporter.collectLangpackEntries({
    db,
    modId,
    modPath,
    srcLang,
    targetLang,
  });
  if (files.length === 0) throw new Error(exporter.emptyLangpackMessage);

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-'));
  try {
    const packed = (await exporter.finalizeLangpackEntries?.(files, stagingDir)) ?? files;
    if (packed.length === 0) throw new Error(exporter.emptyLangpackMessage);

    const zipBuffer = await packFilesToZip(packed);
    log.info(
      `${exporter.logLabel}: ZIP ready — ${packed.length} file(s), ${zipBuffer.length} bytes`,
    );
    return { zipBuffer, zipFileName };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
};

/**
 * Build a full localized mod ZIP: every asset of the mod, translations applied.
 */
export const exportFullModZip = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameId = DEFAULT_GAME_ID,
): Promise<{ zipBuffer: Buffer; zipFileName: string }> =>
  gamePlugin(game).export.exportFullModZip({ db, modId, modPath, srcLang, targetLang });
