/**
 * espWriter.ts
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
import { log } from '../logger.js';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUB_HEADER_SIZE = 6;

const FLAG_COMPRESSED = 0x00040000;

// ────────────────────────────────────────────────────────────────────────────
// Localized helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a translated strings map by overlaying translations on top of the
 * source locale map.  Entries without a translation keep their source text.
 *
 * @param sourceMap   id → source text (from parseStringsBuffer)
 * @param translations id → translated text
 */
export function patchStringsMap(
  sourceMap: Map<number, string>,
  translations: Map<number, string>,
): Map<number, string> {
  const result = new Map(sourceMap);
  for (const [id, text] of translations) {
    if (result.has(id)) result.set(id, text);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Non-localized ESP binary patcher
// ────────────────────────────────────────────────────────────────────────────

export interface EspPatch {
  /** 8-char uppercase hex FormID, e.g. "0001A2B3" */
  formId: string;
  /** 4-char subrecord signature, e.g. "FULL" */
  subrecord: string;
  newText: string;
}

/** Internal: formIdHex → (subrecordSig → newText) */
type PatchMap = Map<string, Map<string, string>>;

function buildPatchMap(patches: EspPatch[]): PatchMap {
  const map: PatchMap = new Map();
  for (const p of patches) {
    const key = p.formId.toUpperCase().padStart(8, '0');
    if (!map.has(key)) map.set(key, new Map());
    map.get(key)!.set(p.subrecord.toUpperCase(), p.newText);
  }
  return map;
}

/**
 * Patch a non-localized ESP buffer.  Returns a new Buffer — the input is not modified.
 *
 * @param inputBuf  Contents of the original .esp/.esm/.esl
 * @param patches   List of (formId, subrecord, newText) changes
 */
export function patchEsp(inputBuf: Buffer, patches: EspPatch[]): Buffer {
  log.info(`ESP patcher: applying ${patches.length} patches`);
  if (patches.length === 0) return inputBuf;

  const patchMap = buildPatchMap(patches);

  // Keep TES4 record unchanged
  const tes4DataSize = inputBuf.readUInt32LE(4);
  const tes4End = RECORD_HEADER_SIZE + tes4DataSize;
  const tes4Buf = inputBuf.subarray(0, tes4End);

  const body = rebuildRange(inputBuf, tes4End, inputBuf.length, patchMap);
  return Buffer.concat([tes4Buf, body]);
}

// ────────────────────────────────────────────────────────────────────────────
// Recursive rebuilder
// ────────────────────────────────────────────────────────────────────────────

function rebuildRange(buf: Buffer, start: number, end: number, patchMap: PatchMap): Buffer {
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
      if (recPatches && recPatches.size > 0) {
        const originalData = buf.subarray(pos + RECORD_HEADER_SIZE, recordEnd);
        const { newData, newFlags } = rebuildRecordData(originalData, flags, recPatches);

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
}

function rebuildRecordData(
  data: Buffer,
  flags: number,
  patches: Map<string, string>,
): { newData: Buffer; newFlags: number } {
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

  const subChunks: Buffer[] = [];
  let pos = 0;

  while (pos + SUB_HEADER_SIZE <= recordBuf.length) {
    const subSig = recordBuf.toString('ascii', pos, pos + 4);
    const subSize = recordBuf.readUInt16LE(pos + 4);
    const dataEnd = pos + SUB_HEADER_SIZE + subSize;

    const newText = patches.get(subSig.toUpperCase());
    if (newText !== undefined) {
      const newBuf = Buffer.from(newText + '\0', 'utf8');
      const newHeader = Buffer.allocUnsafe(SUB_HEADER_SIZE);
      newHeader.write(subSig, 0, 'ascii');
      newHeader.writeUInt16LE(newBuf.length, 4);
      subChunks.push(newHeader, newBuf);
    } else {
      subChunks.push(recordBuf.subarray(pos, dataEnd));
    }
    pos = dataEnd;
  }

  const rebuilt = Buffer.concat(subChunks);

  if (isCompressed) {
    const deflated = deflateSync(rebuilt);
    const sizeBuf = Buffer.allocUnsafe(4);
    sizeBuf.writeUInt32LE(rebuilt.length, 0);
    return { newData: Buffer.concat([sizeBuf, deflated]), newFlags: flags };
  }

  return { newData: rebuilt, newFlags: flags };
}
