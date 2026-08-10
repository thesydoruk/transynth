import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Tx } from '../db';
import { resolveModStoredPath } from '../modStorage';

/**
 * FO4/Skyrim voice files are named `<FormID>_<responseNumber>.fuz`.
 * `responseNumber` comes from INFO `TRDA` (uint32 at offset 4), not from the
 * ordinal of imported NAM1 strings (`ROW_NUMBER`).
 *
 * Map value: response numbers for each non-empty NAM1, in ESP walk order
 * (same order as `ORDER BY strings.id` after import).
 */
export type InfoVoiceResponseMap = Map<string, number[]>;

const RECORD_HEADER = 24;
const GRUP_HEADER = 24;
const FLAG_COMPRESSED = 0x0004_0000;
/** Sane FO4 dialogue response index range (filters corrupt / misaligned reads). */
const MAX_RESPONSE_NUMBER = 64;

type CacheEntry = {
  mtimeMs: number;
  size: number;
  map: InfoVoiceResponseMap;
};

const cache = new Map<string, CacheEntry>();

const readSig = (buf: Buffer, off: number): string => buf.toString('ascii', off, off + 4);

const parseInfoResponses = (recordData: Buffer): number[] => {
  const responses: number[] = [];
  let pos = 0;
  let nam1Ordinal = 0;
  let pendingResp: number | null = null;

  while (pos + 6 <= recordData.length) {
    const subSig = readSig(recordData, pos);
    const subSize = recordData.readUInt16LE(pos + 4);
    const dataStart = pos + 6;
    const dataEnd = dataStart + subSize;
    if (dataEnd > recordData.length) break;

    if (subSig === 'TRDA' && subSize >= 8) {
      const raw = recordData.readUInt32LE(dataStart + 4);
      pendingResp = raw >= 1 && raw <= MAX_RESPONSE_NUMBER ? raw : null;
    } else if (subSig === 'NAM1') {
      nam1Ordinal += 1;
      let keep = false;
      if (subSize === 4) {
        keep = recordData.readUInt32LE(dataStart) !== 0;
      } else if (subSize > 0) {
        const text = recordData.toString('utf8', dataStart, dataEnd).replace(/\0/g, '');
        keep = text.length > 0;
      }
      if (keep) {
        responses.push(pendingResp != null ? pendingResp : nam1Ordinal);
      }
      pendingResp = null;
    }

    pos = dataEnd;
  }
  return responses;
};

const walkPlugin = (buf: Buffer, start: number, end: number, out: InfoVoiceResponseMap): void => {
  let pos = start;
  while (pos + 4 <= end) {
    const sig = readSig(buf, pos);
    if (sig === 'GRUP') {
      if (pos + GRUP_HEADER > end) break;
      const groupSize = buf.readUInt32LE(pos + 4);
      const groupEnd = pos + groupSize;
      if (groupEnd > end || groupSize < GRUP_HEADER) break;
      walkPlugin(buf, pos + GRUP_HEADER, groupEnd, out);
      pos = groupEnd;
      continue;
    }
    if (pos + RECORD_HEADER > end) break;
    const dataSize = buf.readUInt32LE(pos + 4);
    const flags = buf.readUInt32LE(pos + 8);
    const formId = buf.readUInt32LE(pos + 12);
    const dataStart = pos + RECORD_HEADER;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > end) break;

    if (sig === 'INFO') {
      try {
        const recordData =
          flags & FLAG_COMPRESSED
            ? inflateSync(buf.subarray(dataStart + 4, dataEnd))
            : buf.subarray(dataStart, dataEnd);
        const responses = parseInfoResponses(recordData);
        if (responses.length > 0) {
          out.set(formId.toString(16).toUpperCase().padStart(8, '0'), responses);
        }
      } catch {
        // Skip corrupt compressed INFO records.
      }
    }
    pos = dataEnd;
  }
};

/** Parse (or return cached) FormID → TRDA response numbers for one plugin. */
export const loadInfoVoiceResponseNumbers = (pluginAbsPath: string): InfoVoiceResponseMap => {
  let abs: string;
  try {
    abs = fs.realpathSync(path.resolve(pluginAbsPath));
  } catch {
    abs = path.resolve(pluginAbsPath);
  }

  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return new Map();
  }

  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.map;

  const buf = fs.readFileSync(abs);
  if (buf.length < RECORD_HEADER + 4) return new Map();
  const map: InfoVoiceResponseMap = new Map();
  const tes4Size = buf.readUInt32LE(4);
  walkPlugin(buf, RECORD_HEADER + tes4Size, buf.length, map);
  cache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, map });
  return map;
};

/** Resolve `mods.abs_path` for a mod and load its INFO→response# map (empty if missing). */
export const loadModInfoVoiceResponseNumbers = async (
  db: Tx,
  modId: number,
): Promise<InfoVoiceResponseMap> => {
  const { rows } = await db.query<{ abs_path: string | null }>(
    `SELECT abs_path FROM mods WHERE id = $1`,
    [modId],
  );
  const stored = rows[0]?.abs_path?.trim();
  if (!stored) return new Map();
  const pluginPath = resolveModStoredPath(stored);
  if (!fs.existsSync(pluginPath)) return new Map();
  return loadInfoVoiceResponseNumbers(pluginPath);
};

/**
 * Map 1-based NAM1 ordinal (`ROW_NUMBER`) to the voice-file response number.
 * Falls back to the ordinal when the plugin map is missing or short.
 */
export const voiceVariantFromOrdinal = (
  ordinal: number,
  responses: number[] | undefined,
): number => {
  if (!Number.isFinite(ordinal) || ordinal < 1) return ordinal;
  const mapped = responses?.[ordinal - 1];
  return mapped != null && mapped >= 1 ? mapped : ordinal;
};

/** @internal test helper */
export const _resetInfoVoiceResponseCacheForTests = (): void => {
  cache.clear();
};
