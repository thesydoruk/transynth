import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBa2 } from '../../formats/ba2';
import { log } from '../../logger';
import type { GameType } from '../../types';
import type { ZipPackEntry } from './exportTypes';
import { normalizeLangpackZipPath } from './langpackMerge';

export const UA_SOUND_PACK_ESP = 'UASoundPack.esp';
export const UA_SOUND_PACK_BA2 = 'UASoundPack - Main.ba2';

const uaSoundPackEspPath = (): string => {
  const beside = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'assets',
    UA_SOUND_PACK_ESP,
  );
  if (fs.existsSync(beside)) return beside;
  return path.join(process.cwd(), 'src', 'web', 'export', 'assets', UA_SOUND_PACK_ESP);
};

export const isLangpackVoicePath = (raw: string): boolean =>
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
 * Returns how many files were added (0 or 2).
 */
export const writeUaSoundPackIntoDir = (
  dir: string,
  voice: ZipPackEntry[],
  game: GameType,
): number => {
  if (game !== 'fo4' || voice.length === 0) return 0;
  const espSrc = uaSoundPackEspPath();
  if (!fs.existsSync(espSrc)) {
    throw new Error(`UASoundPack.esp is missing next to the exporter (${espSrc})`);
  }
  const espDest = path.join(dir, UA_SOUND_PACK_ESP);
  const ba2Dest = path.join(dir, UA_SOUND_PACK_BA2);
  fs.copyFileSync(espSrc, espDest);
  writeBa2(
    voice.map((entry) => ({
      name: entry.name.replace(/\//g, '\\'),
      data: entry.data,
      absPath: entry.absPath,
    })),
    ba2Dest,
  );
  log.info(
    `Langpack export: packed ${voice.length} voice file(s) into uncompressed ${UA_SOUND_PACK_BA2}`,
  );
  return 2;
};
