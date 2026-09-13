import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { log } from '../../logger';
import { collectLangpackEntries } from './langpackCollect';
import { mergeLangpackEntries, type TaggedLangpackEntry } from './langpackMerge';
import { writeLangpackEntriesToDir } from './langpackStage';
import { splitLangpackVoiceEntries, writeUaSoundPackIntoDir } from './uaSoundPack';
import { zipDirectoryToPath } from './zipPack';
import type { VortexFileWinner } from '../../vortex/types';

export { mergeLangpackEntries, normalizeLangpackZipPath } from './langpackMerge';

export type LangpackBatchMod = {
  modId: number;
  modPath: string;
  game: GameType;
  sourceFolder?: string | null;
};

export type LangpackZipProgress = (done: number, total: number) => void | Promise<void>;

export type LangpackZipToPathResult = {
  zipFileName: string;
  byteSize: number;
  fileCount: number;
};

const langpackZipFileName = (game: GameType, targetLang: string): string =>
  `${game}_${targetLang}_langpack.zip`;

/**
 * Stage each mod onto a shared Data tree (later mods overwrite, unless Vortex
 * file winners are passed), then stream one Vortex-installable ZIP to `destPath`.
 */
export const exportLangpackZipToPath = async (
  db: Tx,
  mods: LangpackBatchMod[],
  srcLang: string,
  targetLang: string,
  destPath: string,
  onProgress?: LangpackZipProgress,
  options?: { fileWinners?: readonly VortexFileWinner[] },
): Promise<LangpackZipToPathResult> => {
  const stagingDir = `${destPath}.staging`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  let fileCount = 0;
  try {
    const tagged: TaggedLangpackEntry[] = [];
    for (let i = 0; i < mods.length; i++) {
      const mod = mods[i]!;
      const files = await collectLangpackEntries(
        db,
        mod.modId,
        mod.modPath,
        srcLang,
        targetLang,
        mod.game,
      );
      if (files.length === 0) {
        log.info(`Batch langpack: no exportable content for mod ${mod.modId}, skipping`);
      } else {
        for (const entry of files) {
          tagged.push({ entry, sourceFolder: mod.sourceFolder ?? null });
        }
        log.info(`Batch langpack: staged ${files.length} file(s) from mod ${mod.modId}`);
      }
      await onProgress?.(i + 1, mods.length);
    }

    const game = mods[0]?.game ?? 'fo4';
    const merged = mergeLangpackEntries(tagged, options?.fileWinners);
    const { rest, voice } =
      game === 'fo4' ? splitLangpackVoiceEntries(merged) : { rest: merged, voice: [] };
    fileCount = writeLangpackEntriesToDir(stagingDir, rest);
    fileCount += writeUaSoundPackIntoDir(stagingDir, voice, game);

    if (fileCount === 0) {
      throw new Error(
        'No exportable langpack content found for the selected mods — no translated STRINGS, PEX, MCM, Interface, voice, or ESP patches available.',
      );
    }

    const byteSize = await zipDirectoryToPath(stagingDir, destPath);
    const zipFileName = path.basename(destPath) || langpackZipFileName(game, targetLang);
    log.info(
      `Batch langpack: ZIP ready — ${fileCount} file(s) from ${mods.length} mod(s), ${byteSize} bytes → ${destPath}`,
    );
    return { zipFileName, byteSize, fileCount };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
};

/**
 * One Vortex-installable langpack ZIP for many mods (in-memory, tests / small packs).
 */
export const exportLangpackZipBatch = async (
  db: Tx,
  mods: LangpackBatchMod[],
  srcLang: string,
  targetLang: string,
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const game = mods[0]?.game ?? 'fo4';
  const zipFileName = langpackZipFileName(game, targetLang);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-zip-'));
  const destPath = path.join(tmpDir, zipFileName);
  try {
    await exportLangpackZipToPath(db, mods, srcLang, targetLang, destPath);
    return { zipBuffer: fs.readFileSync(destPath), zipFileName };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
