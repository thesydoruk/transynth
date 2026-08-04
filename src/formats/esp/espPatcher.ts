/**
 * EspWriter.ts
 *
 * Two modes of operation:
 *
 * 1. LOCALIZED mods — text lives in .STRINGS/.DLSTRINGS/.ILSTRINGS files, not in the ESP.
 *    Use patchStringsMap() to layer translations onto a source-locale strings map, then
 *    serialize with writeStringsBuffer() from stringsFile.ts.
 *
 * 2. NON-LOCALIZED mods — text is embedded directly in subrecords inside the ESP binary.
 *    Use patchEsp() to produce a new buffer with replaced subrecord text.
 *
 * Binary sizes at every level are recalculated automatically.
 */

import { inflateSync, deflateSync } from 'zlib';
import { log } from '../../logger';
import type { EspPatch } from '../types';
import { buildRecordPatchPlan, groupPatchesBySig, type SubrecordSlot } from './espPatchPlan';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUB_HEADER_SIZE = 6;

const FLAG_COMPRESSED = 0x00040000;

// ────────────────────────────────────────────────────────────────────────────
// Localized helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a translated strings map by overlaying translations on top of the
 * source locale map.
 *
 * Entries that do not have an explicit translation keep their original source
 * text. This is the core primitive used by the STRINGS export pipeline:
 * a fully-populated source map is combined with zero or more translated
 * entries to produce the final target-locale tables.
 *
 * @param sourceMap - `id → source text` pairs, typically from `parseStringsBuffer()`.
 * @param translations - `id → translated text` overrides for a specific target language.
 * @returns New map instance combining source and translated values.
 */
export const patchStringsMap = (
  sourceMap: Map<number, string>,
  translations: Map<number, string>,
): Map<number, string> => {
  const result = new Map(sourceMap);
  for (const [id, text] of translations) {
    if (result.has(id)) result.set(id, text);
  }
  return result;
};

// ────────────────────────────────────────────────────────────────────────────
// Non-localized ESP binary patcher
// ────────────────────────────────────────────────────────────────────────────

/** Internal: mapping of `FormID → patches targeting that record`. */
type PatchMap = Map<string, EspPatch[]>;

/**
 * Group a flat list of ESP patches by FormID.
 *
 * The returned map makes it cheap to decide, for each record, whether any of its
 * subrecords need to be rewritten. Patches for repeated subrecords of one record
 * are kept as a list; {@link buildRecordPatchPlan} binds each one to a specific
 * occurrence later.
 *
 * @param patches - Flat list of patch descriptors requested by the caller.
 * @returns Lookup structure keyed by canonicalised FormID.
 */
const buildPatchMap = (patches: EspPatch[]): PatchMap => {
  const map: PatchMap = new Map();
  for (const p of patches) {
    const key = p.formId.toUpperCase().padStart(8, '0');
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return map;
};

/**
 * Apply textual patches to a non-localized ESP/ESM/ESL plugin.
 *
 * The function walks the full plugin structure, rewriting only the specified
 * subrecords and recalculating all affected record and group sizes. The
 * original buffer is never mutated; a new buffer containing the patched
 * plugin is returned instead.
 *
 * Compressed records are transparently decompressed, patched, and then
 * recompressed so that the output remains structurally compatible with the
 * source.
 *
 * @param inputBuf - Contents of the original plugin file.
 * @param patches - List of `(formId, subrecord, newText)` changes to apply.
 * @returns New {@link Buffer} representing the patched plugin.
 */
export const patchEsp = (inputBuf: Buffer, patches: EspPatch[]): Buffer => {
  log.info(`ESP patcher: applying ${patches.length} patches`);
  if (patches.length === 0) return inputBuf;

  const patchMap = buildPatchMap(patches);

  // Keep TES4 record unchanged
  const tes4DataSize = inputBuf.readUInt32LE(4);
  const tes4End = RECORD_HEADER_SIZE + tes4DataSize;
  const tes4Buf = inputBuf.subarray(0, tes4End);

  const body = rebuildRange(inputBuf, tes4End, inputBuf.length, patchMap);
  return Buffer.concat([tes4Buf, body]);
};

// ────────────────────────────────────────────────────────────────────────────
// Recursive rebuilder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Recursively rebuild a contiguous range of plugin records.
 *
 * GRUP records are reassembled with a fresh `groupSize` that reflects the
 * total size of their rebuilt children. Non-GRUP records are either copied
 * verbatim or rebuilt via {@link rebuildRecordData} when at least one
 * matching subrecord patch exists.
 *
 * @param buf - Original plugin buffer.
 * @param start - Inclusive start offset of the range to rebuild.
 * @param end - Exclusive end offset of the range to rebuild.
 * @param patchMap - Pre-grouped patch lookup map.
 * @returns A new buffer containing the rebuilt data for the requested range.
 */
const rebuildRange = (buf: Buffer, start: number, end: number, patchMap: PatchMap): Buffer => {
  const chunks: Buffer[] = [];
  let pos = start;

  while (pos + RECORD_HEADER_SIZE <= end) {
    const sig = buf.toString('ascii', pos, pos + 4);

    if (sig === 'GRUP') {
      const groupSize = buf.readUInt32LE(pos + 4);
      const grupEnd = pos + groupSize;
      const innerStart = pos + GRUP_HEADER_SIZE;
      const innerEnd = Math.min(grupEnd, end);

      const innerBuf = rebuildRange(buf, innerStart, innerEnd, patchMap);

      // Rebuild GRUP header with updated groupSize
      const grupHeader = Buffer.from(buf.subarray(pos, pos + GRUP_HEADER_SIZE));
      grupHeader.writeUInt32LE(GRUP_HEADER_SIZE + innerBuf.length, 4);

      chunks.push(grupHeader, innerBuf);
      pos = grupEnd;
    } else {
      const dataSize = buf.readUInt32LE(pos + 4);
      const flags = buf.readUInt32LE(pos + 8);
      const formIdRaw = buf.readUInt32LE(pos + 12);
      const formIdHex = formIdRaw.toString(16).toUpperCase().padStart(8, '0');
      const recordEnd = pos + RECORD_HEADER_SIZE + dataSize;

      const recPatches = patchMap.get(formIdHex);
      if (recPatches && recPatches.length > 0) {
        const originalData = buf.subarray(pos + RECORD_HEADER_SIZE, recordEnd);
        const { newData, newFlags } = rebuildRecordData(originalData, flags, recPatches, formIdHex);

        const recHeader = Buffer.from(buf.subarray(pos, pos + RECORD_HEADER_SIZE));
        recHeader.writeUInt32LE(newData.length, 4);
        recHeader.writeUInt32LE(newFlags, 8);

        chunks.push(recHeader, newData);
      } else {
        chunks.push(buf.subarray(pos, recordEnd));
      }
      pos = recordEnd;
    }
  }

  return Buffer.concat(chunks);
};

/** Internal: subrecord boundaries of one record, in file order. */
type SubrecordBounds = { start: number; end: number; sig: string };

/**
 * Walk a record payload, collecting subrecord boundaries and — for the signatures
 * that have patches — the current text of each occurrence.
 */
const scanSubrecords = (
  recordBuf: Buffer,
  patchedSigs: Set<string>,
): { bounds: SubrecordBounds[]; slots: SubrecordSlot[] } => {
  const bounds: SubrecordBounds[] = [];
  const slots: SubrecordSlot[] = [];
  let pos = 0;

  while (pos + SUB_HEADER_SIZE <= recordBuf.length) {
    const sig = recordBuf.toString('ascii', pos, pos + 4);
    const subSize = recordBuf.readUInt16LE(pos + 4);
    const dataStart = pos + SUB_HEADER_SIZE;
    const end = dataStart + subSize;
    const key = sig.toUpperCase();

    if (patchedSigs.has(key)) {
      slots.push({
        position: bounds.length,
        sig: key,
        text: recordBuf.toString('utf8', dataStart, end).replace(/\0/g, ''),
      });
    }
    bounds.push({ start: pos, end, sig });
    pos = end;
  }

  return { bounds, slots };
};

/**
 * Rebuild a single record's data segment, applying subrecord-level patches.
 *
 * Compressed records are handled transparently:
 * - decompress to a transient buffer,
 * - apply subrecord replacements,
 * - recompress and prepend the uncompressed-size field.
 *
 * When decompression fails for any reason, the original data and flags are
 * returned unchanged to avoid corrupting the archive.
 *
 * @param data - Original record data payload (excluding the 24-byte record header).
 * @param flags - Record flags controlling compression.
 * @param patches - Patches targeting this specific record.
 * @param formIdHex - Record FormID, for diagnostics only.
 * @returns Object containing the rebuilt data buffer and updated flags.
 */
const rebuildRecordData = (
  data: Buffer,
  flags: number,
  patches: EspPatch[],
  formIdHex: string,
): { newData: Buffer; newFlags: number } => {
  const isCompressed = (flags & FLAG_COMPRESSED) !== 0;

  let recordBuf = data;
  if (isCompressed) {
    const uncompSize = data.readUInt32LE(0);
    try {
      recordBuf = inflateSync(data.subarray(4));
      void uncompSize; // used implicitly via inflateSync
    } catch {
      return { newData: data, newFlags: flags };
    }
  }

  const patchesBySig = groupPatchesBySig(patches);
  const { bounds, slots } = scanSubrecords(recordBuf, new Set(patchesBySig.keys()));
  const { byPosition, unplaced } = buildRecordPatchPlan(slots, patchesBySig);

  if (unplaced.length > 0) {
    const fields = [...new Set(unplaced.map((p) => p.subrecord.toUpperCase()))].join(', ');
    log.warn(
      `ESP patcher: record ${formIdHex} has fewer ${fields} subrecords than translations; ` +
        `${unplaced.length} patch(es) skipped`,
    );
  }

  const subChunks: Buffer[] = [];
  for (const [position, { start, end, sig }] of bounds.entries()) {
    const newText = byPosition.get(position);
    if (newText === undefined) {
      subChunks.push(recordBuf.subarray(start, end));
      continue;
    }
    const newBuf = Buffer.from(newText + '\0', 'utf8');
    const newHeader = Buffer.allocUnsafe(SUB_HEADER_SIZE);
    newHeader.write(sig, 0, 'ascii');
    newHeader.writeUInt16LE(newBuf.length, 4);
    subChunks.push(newHeader, newBuf);
  }

  const rebuilt = Buffer.concat(subChunks);

  if (isCompressed) {
    const deflated = deflateSync(rebuilt);
    const sizeBuf = Buffer.allocUnsafe(4);
    sizeBuf.writeUInt32LE(rebuilt.length, 0);
    return { newData: Buffer.concat([sizeBuf, deflated]), newFlags: flags };
  }

  return { newData: rebuilt, newFlags: flags };
};
