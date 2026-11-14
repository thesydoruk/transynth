import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBa2File } from '../../formats/ba2';
import { log } from '../../logger';
import type { ZipPackEntry } from './exportTypes';
import { normalizeLangpackZipPath } from './langpackMerge';

export const UA_SOUND_PACK_ESP = 'UASoundPack.esp';
export const UA_SOUND_PACK_BA2 = 'UASoundPack - Main.ba2';

/**
 * File names of the voice plugin and its archive.
 *
 * A langpack of one mod carries the mod's name, so two of them installed side
 * by side do not overwrite each other's plugin; the pack of a whole game keeps
 * the bare name. The engine pairs the archive with the plugin by this stem.
 */
export const uaSoundPackNames = (modName?: string): { esp: string; ba2: string } => {
  const stem = modName?.trim() ? `UASoundPack - ${modName.trim()}` : 'UASoundPack';
  return { esp: `${stem}.esp`, ba2: `${stem} - Main.ba2` };
};

/** The dummy voice plugin under either name. */
export const isUaSoundPackEsp = (fileName: string): boolean =>
  /^UASoundPack( - .+)?\.esp$/i.test(fileName);

const uaSoundPackEspPath = (): string => {
  const beside = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'assets',
    UA_SOUND_PACK_ESP,
  );
  if (fs.existsSync(beside)) return beside;
  return path.join(process.cwd(), 'src', 'web', 'export', 'assets', UA_SOUND_PACK_ESP);
};

const isLangpackVoicePath = (raw: string): boolean =>
  normalizeLangpackZipPath(raw).toLowerCase().startsWith('sound/voice/');

export const splitLangpackVoiceEntries = (
  entries: ZipPackEntry[],
): { rest: ZipPackEntry[]; voice: ZipPackEntry[] } => {
  const rest: ZipPackEntry[] = [];
  const voice: ZipPackEntry[] = [];
  for (const entry of entries) {
    const name = normalizeLangpackZipPath(entry.name);
    if (!name) continue;
    if (isLangpackVoicePath(name)) voice.push({ ...entry, name });
    else rest.push({ ...entry, name });
  }
  return { rest, voice };
};

/**
 * Write dummy UASoundPack.esp + uncompressed UASoundPack - Main.ba2 into `dir`.
 *
 * Only a title whose engine refuses loose voice needs this; the caller decides
 * (see `CreationEngineTitle.voice.packLangpackVoiceIntoBa2`).
 * The archive is streamed asynchronously: a full game's voice runs to hundreds
 * of thousands of takes, and a synchronous copy would freeze the worker past
 * its job-lock heartbeat. Returns how many files were added (0 or 2).
 */
export const writeUaSoundPackIntoDir = async (
  dir: string,
  voice: ZipPackEntry[],
  modName?: string,
): Promise<number> => {
  if (voice.length === 0) return 0;
  const espSrc = uaSoundPackEspPath();
  if (!fs.existsSync(espSrc)) {
    throw new Error(`UASoundPack.esp is missing next to the exporter (${espSrc})`);
  }
  const names = uaSoundPackNames(modName);
  const espDest = path.join(dir, names.esp);
  const ba2Dest = path.join(dir, names.ba2);
  fs.copyFileSync(espSrc, espDest);
  await writeBa2File(
    voice.map((entry) => ({
      name: entry.name.replace(/\//g, '\\'),
      data: entry.data,
      absPath: entry.absPath,
    })),
    ba2Dest,
  );
  log.info(`Langpack export: packed ${voice.length} voice file(s) into uncompressed ${names.ba2}`);
  return 2;
};
