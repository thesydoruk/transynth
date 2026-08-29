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

/**
 * INFO records that reuse another INFO's responses through `DNAM`.
 *
 * Bethesda mirrors a line across voice types this way — e.g. the spouse INFO
 * `0022B5CD` (PlayerVoiceMale01) carries no text of its own and points at
 * `001AC372`. Its `.fuz` still uses its own FormID, so matching has to follow
 * the pointer to find the text. Keyed and valued by lower-6 FormID.
 */
export type InfoSharedResponseMap = Map<string, string>;

/** Everything one plugin walk yields about voiced INFO slots. */
export type InfoVoiceSlots = {
  responses: InfoVoiceResponseMap;
  sharedFrom: InfoSharedResponseMap;
};

const RECORD_HEADER = 24;
const GRUP_HEADER = 24;
const FLAG_COMPRESSED = 0x0004_0000;
/** FO4 `TRDA` is a fixed 20-byte struct; the response number lives at offset 4. */
const TRDA_SIZE = 20;
/**
 * Upper bound for a plausible response number, only to reject misaligned reads.
 *
 * Bethesda writers assign these by hand and vanilla `Fallout4.esm` goes well past
 * the response count — e.g. INFO `001505FB` uses 1, 102, 103, 104, 105, matching
 * `001505FB_102.fuz` … `_105.fuz`. A tight bound silently dropped those numbers,
 * fell back to the NAM1 ordinal, and left the audio unmatched.
 */
const MAX_RESPONSE_NUMBER = 9999;
/** Distinct plugin paths kept in memory (LRU). */
const MAX_CACHED_PLUGINS = 8;

type CacheEntry = {
  mtimeMs: number;
  size: number;
  slots: InfoVoiceSlots;
};

const lower6 = (formId: number): string =>
  formId.toString(16).toUpperCase().padStart(8, '0').substring(2);

const cache = new Map<string, CacheEntry>();

const readSig = (buf: Buffer, off: number): string => buf.toString('ascii', off, off + 4);

type ParsedInfo = {
  responses: number[];
  /** Lower-6 FormID of the INFO this record borrows its responses from. */
  sharedFrom: string | null;
};

const parseInfoResponses = (recordData: Buffer): ParsedInfo => {
  const responses: number[] = [];
  let pos = 0;
  let nam1Ordinal = 0;
  let pendingResp: number | null = null;
  let sharedFrom: string | null = null;

  while (pos + 6 <= recordData.length) {
    const subSig = readSig(recordData, pos);
    const subSize = recordData.readUInt16LE(pos + 4);
    const dataStart = pos + 6;
    const dataEnd = dataStart + subSize;
    if (dataEnd > recordData.length) break;

    if (subSig === 'DNAM' && subSize === 4) {
      const target = recordData.readUInt32LE(dataStart);
      if (target !== 0) sharedFrom = lower6(target);
    } else if (subSig === 'TRDA' && subSize >= TRDA_SIZE) {
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
  return { responses, sharedFrom };
};

const walkPlugin = (buf: Buffer, start: number, end: number, out: InfoVoiceSlots): void => {
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
        const parsed = parseInfoResponses(recordData);
        if (parsed.responses.length > 0) {
          out.responses.set(formId.toString(16).toUpperCase().padStart(8, '0'), parsed.responses);
        } else if (parsed.sharedFrom) {
          out.sharedFrom.set(lower6(formId), parsed.sharedFrom);
        }
      } catch {
        // Skip corrupt compressed INFO records.
      }
    }
    pos = dataEnd;
  }
};

const emptySlots = (): InfoVoiceSlots => ({ responses: new Map(), sharedFrom: new Map() });

/** Parse (or return cached) voiced INFO slots — response numbers and DNAM aliases. */
export const loadInfoVoiceSlots = (pluginAbsPath: string): InfoVoiceSlots => {
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
    return emptySlots();
  }

  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    cache.delete(abs);
    cache.set(abs, hit);
    return hit.slots;
  }

  const buf = fs.readFileSync(abs);
  if (buf.length < RECORD_HEADER + 4) return emptySlots();
  const slots = emptySlots();
  const tes4Size = buf.readUInt32LE(4);
  walkPlugin(buf, RECORD_HEADER + tes4Size, buf.length, slots);
  cache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, slots });
  while (cache.size > MAX_CACHED_PLUGINS) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
  return slots;
};

/** Parse (or return cached) FormID → TRDA response numbers for one plugin. */
export const loadInfoVoiceResponseNumbers = (pluginAbsPath: string): InfoVoiceResponseMap =>
  loadInfoVoiceSlots(pluginAbsPath).responses;

/** Resolve `mods.abs_path` and load the plugin's voiced INFO slots (empty if missing). */
export const loadModInfoVoiceSlots = async (db: Tx, modId: number): Promise<InfoVoiceSlots> => {
  const { rows } = await db.query<{ abs_path: string | null }>(
    `SELECT abs_path FROM mods WHERE id = $1`,
    [modId],
  );
  const stored = rows[0]?.abs_path?.trim();
  if (!stored) return emptySlots();
  const pluginPath = resolveModStoredPath(stored);
  if (!fs.existsSync(pluginPath)) return emptySlots();
  return loadInfoVoiceSlots(pluginPath);
};

/** Resolve `mods.abs_path` for a mod and load its INFO→response# map (empty if missing). */
export const loadModInfoVoiceResponseNumbers = async (
  db: Tx,
  modId: number,
): Promise<InfoVoiceResponseMap> => (await loadModInfoVoiceSlots(db, modId)).responses;

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

/** @internal test helper */
export const _infoVoiceResponseCacheSizeForTests = (): number => cache.size;
