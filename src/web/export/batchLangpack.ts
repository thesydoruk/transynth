import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { log } from '../../logger';
import { collectLangpackEntries } from './langpackCollect';
import type { ZipPackEntry } from './exportTypes';
import { packFilesToZip } from './zipPack';

export type LangpackBatchMod = {
  modId: number;
  modPath: string;
  game: GameType;
};

/** Flatten zip paths so Vortex sees one Data tree, not a folder per mod. */
export const normalizeLangpackZipPath = (raw: string): string => {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return cleaned.replace(/^data\//i, '');
};

/** Merge entries onto shared game paths; later mods win on case-insensitive collisions. */
export const mergeLangpackEntries = (entries: ZipPackEntry[]): ZipPackEntry[] => {
  const byKey = new Map<string, ZipPackEntry>();
  for (const entry of entries) {
    const name = normalizeLangpackZipPath(entry.name);
    if (!name) continue;
    byKey.set(name.toLowerCase(), { ...entry, name });
  }
  return [...byKey.values()];
};

/**
 * One Vortex-installable langpack ZIP for many mods: loose files at Data-root
 * (`Strings/`, `Interface/`, `MCM/`, plugins) with no nested per-mod folders.
 */
export const exportLangpackZipBatch = async (
  db: Tx,
  mods: LangpackBatchMod[],
  srcLang: string,
  targetLang: string,
): Promise<{ zipBuffer: Buffer; zipFileName: string }> => {
  const collected: ZipPackEntry[] = [];
  for (const mod of mods) {
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
      continue;
    }
    collected.push(...files);
    log.info(`Batch langpack: collected ${files.length} file(s) from mod ${mod.modId}`);
  }

  const files = mergeLangpackEntries(collected);
  if (files.length === 0) {
    throw new Error(
      'No exportable langpack content found for the selected mods — no translated STRINGS, PEX, MCM, Interface, voice, or ESP patches available.',
    );
  }

  const game = mods[0]?.game ?? 'fo4';
  const zipFileName = `${game}_${targetLang}_langpack.zip`;
  const zipBuffer = await packFilesToZip(files);
  log.info(
    `Batch langpack: ZIP ready — ${files.length} file(s) from ${mods.length} mod(s), ${zipBuffer.length} bytes`,
  );
  return { zipBuffer, zipFileName };
};
