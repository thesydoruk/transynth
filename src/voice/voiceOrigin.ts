/**
 * Which plugin a voiced line belongs to — its *origin*.
 *
 * A Creation Engine plugin can carry INFO records it does not own: a patch such
 * as the Unofficial Fallout 4 Patch overrides thousands of `Fallout4.esm` and
 * DLC lines. The game keeps the voice file where the record was born, under
 * `Sound/Voice/<origin plugin>/`, and so does the patch when it ships a fixed
 * take. Two facts follow:
 *
 *   - a voice line is identified by (origin, FormID lower-6, response number),
 *     never by the lower-6 alone — two masters of one plugin can collide there;
 *   - the origin of a record in the database is read off the FormID: its top
 *     byte indexes the plugin's `MAST` list, and an index past that list means
 *     the plugin's own record (this also covers ESL-flagged `FE` FormIDs).
 *
 * Origins are plugin file names in lower case, so a folder on disk and a name
 * from a TES4 header compare equal whatever case either was written in.
 *
 * Known gap: an override of a record owned by an ESL-flagged master is stored
 * as `MM000yyy`, while that master names its own take `FExxxyyy`; those two do
 * not meet here. No mod in the corpus overrides ESL dialogue yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTes4MasterNames } from '../formats/esp/pluginHeader';

const RECORD_HEADER_SIZE = 24;

export type VoiceOriginResolver = {
  /** The plugin's own file name, lower-cased. */
  ownOrigin: string;
  /** `MAST` names in header order (original case). Index = FormID top byte. */
  masters: string[];
  /** Origin of a record by its 8-hex FormID as stored in this plugin. */
  originOfFormid: (formidHex: string) => string;
};

export const normalizeVoiceOrigin = (name: string | null | undefined): string =>
  (name ?? '').trim().toLowerCase();

const masterIndexOf = (formidHex: string): number => {
  const padded = formidHex.trim().toUpperCase().padStart(8, '0');
  const idx = Number.parseInt(padded.slice(0, 2), 16);
  return Number.isFinite(idx) ? idx : 0;
};

export const buildVoiceOriginResolver = (
  pluginFileName: string,
  masters: string[],
): VoiceOriginResolver => {
  const ownOrigin = normalizeVoiceOrigin(path.basename(pluginFileName));
  const normalizedMasters = masters.map(normalizeVoiceOrigin);
  return {
    ownOrigin,
    masters,
    originOfFormid: (formidHex) => {
      const idx = masterIndexOf(formidHex);
      return idx < normalizedMasters.length ? normalizedMasters[idx]! : ownOrigin;
    },
  };
};

type CacheEntry = { mtimeMs: number; size: number; masters: string[] };
const cache = new Map<string, CacheEntry>();
const MAX_CACHED = 32;

/** Read the TES4 `MAST` list of a plugin; a missing or unreadable file has no masters. */
export const readVoiceOriginMasters = (pluginPath: string): string[] => {
  let st: fs.Stats;
  try {
    st = fs.statSync(pluginPath);
  } catch {
    return [];
  }
  const hit = cache.get(pluginPath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.masters;

  let masters: string[] = [];
  try {
    const fd = fs.openSync(pluginPath, 'r');
    try {
      const header = Buffer.alloc(RECORD_HEADER_SIZE);
      if (
        fs.readSync(fd, header, 0, RECORD_HEADER_SIZE, 0) === RECORD_HEADER_SIZE &&
        header.toString('ascii', 0, 4) === 'TES4'
      ) {
        const dataSize = header.readUInt32LE(4);
        const data = Buffer.alloc(dataSize);
        const read = fs.readSync(fd, data, 0, dataSize, RECORD_HEADER_SIZE);
        masters = parseTes4MasterNames(data, read);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    masters = [];
  }

  cache.set(pluginPath, { mtimeMs: st.mtimeMs, size: st.size, masters });
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
  return masters;
};

/** Resolver for a plugin on disk. The file may be absent: then every record is its own. */
export const loadVoiceOriginResolver = (pluginPath: string): VoiceOriginResolver =>
  buildVoiceOriginResolver(pluginPath, readVoiceOriginMasters(pluginPath));

/**
 * Origin folder of a take by its path: the segment right after `Sound/Voice/`,
 * lower-cased. Null when the path has no voice tree in it.
 */
export const originFromVoiceRelPath = (relPath: string): string | null => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i + 2 < parts.length; i += 1) {
    if (parts[i]!.toLowerCase() === 'sound' && parts[i + 1]!.toLowerCase() === 'voice') {
      return normalizeVoiceOrigin(parts[i + 2]);
    }
  }
  return null;
};

/**
 * Speaker (voice-type) folder of a take by its path: the segment after the
 * origin folder, when there is a file below it. Null outside a voice tree.
 */
export const speakerFromVoiceRelPath = (relPath: string): string | null => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i + 4 < parts.length; i += 1) {
    if (parts[i]!.toLowerCase() === 'sound' && parts[i + 1]!.toLowerCase() === 'voice') {
      return parts[i + 3]!;
    }
  }
  return null;
};

/** `<origin>/<FORMID6>` — the group a response number is relative to. */
export const originFormidKey = (origin: string | null | undefined, lineKey: string): string => {
  const key = lineKey.toUpperCase();
  const normalized = normalizeVoiceOrigin(origin);
  return normalized ? `${normalized}/${key}` : key;
};

/** Split `<origin>/<FORMID6>` back into its halves (origin may be absent). */
export const splitOriginFormidKey = (key: string): { origin: string | null; lineKey: string } => {
  const slash = key.lastIndexOf('/');
  if (slash < 0) return { origin: null, lineKey: key };
  return { origin: key.slice(0, slash), lineKey: key.slice(slash + 1) };
};

/** `isVoiceFormidKey`-shaped check that also admits an origin-qualified key. */
export const isOriginVoiceKey = (value: string): boolean =>
  /^[^\s:/]+\/[0-9A-Za-z]{1,32}:\d+$/.test(value);
