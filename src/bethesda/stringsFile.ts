/**
 * stringsFile.ts
 *
 * Reader and writer for Bethesda STRINGS / DLSTRINGS / ILSTRINGS files.
 *
 * Binary format (all values little-endian):
 *   count    : uint32  — number of entries
 *   dataSize : uint32  — total size of the text blob in bytes
 *   entries  : Array<{ id: uint32, offset: uint32 }> — count entries, each 8 bytes
 *   textBlob : Buffer  — dataSize bytes; each string is null-terminated UTF-8
 *
 * STRINGS uses null-terminated strings directly.
 * DLSTRINGS and ILSTRINGS prefix each string with a uint32 length before the text
 * (the null terminator is still present, included in the length).
 */

import { log } from '../logger.js';

export type StringsType = 'STRINGS' | 'DLSTRINGS' | 'ILSTRINGS';

/** A single entry read from a strings file. */
export interface StringsEntry {
  id: number;
  text: string;
}

/**
 * Detect the type of a strings file from its extension.
 */
export const stringsTypeFromPath = (filePath: string): StringsType => {
  const ext = filePath.split('.').pop()?.toUpperCase();
  if (ext === 'DLSTRINGS') return 'DLSTRINGS';
  if (ext === 'ILSTRINGS') return 'ILSTRINGS';
  return 'STRINGS';
}

/**
 * Parse a strings file buffer and return an id→text map.
 */
export const parseStringsBuffer = (buf: Buffer, type: StringsType): Map<number, string> => {
  const result = new Map<number, string>();

  if (buf.length < 8) return result;

  const count = buf.readUInt32LE(0);
  // dataSize at offset 4 — we trust count for iteration
  const entriesStart = 8;
  const blobStart = entriesStart + count * 8;

  if (blobStart > buf.length) return result;

  log.debug(`STRINGS: parsing ${type} buffer — ${count} entries, blob at offset ${blobStart}`);

  for (let i = 0; i < count; i++) {
    const entryOff = entriesStart + i * 8;
    const id = buf.readUInt32LE(entryOff);
    const offset = buf.readUInt32LE(entryOff + 4);
    const absOff = blobStart + offset;

    if (absOff >= buf.length) continue;

    let text: string;
    if (type === 'STRINGS') {
      // Null-terminated string
      const end = buf.indexOf(0, absOff);
      text = buf.toString('utf8', absOff, end === -1 ? buf.length : end);
    } else {
      // DLSTRINGS / ILSTRINGS: uint32 length prefix (includes null terminator)
      if (absOff + 4 > buf.length) continue;
      const len = buf.readUInt32LE(absOff);
      const strStart = absOff + 4;
      const strEnd = strStart + len - 1; // exclude null terminator
      text = buf.toString('utf8', strStart, Math.min(strEnd, buf.length));
    }

    result.set(id, text);
  }

  return result;
}

/**
 * Serialize an id→text map to a strings file buffer.
 */
export const writeStringsBuffer = (
  entries: Map<number, string> | StringsEntry[],
  type: StringsType,
): Buffer => {
  const items: StringsEntry[] =
    entries instanceof Map
      ? Array.from(entries.entries()).map(([id, text]) => ({ id, text }))
      : entries;

  // Build text blob
  const blobParts: Buffer[] = [];
  const offsets: number[] = [];
  let blobOffset = 0;

  for (const { text } of items) {
    offsets.push(blobOffset);
    if (type === 'STRINGS') {
      const strBuf = Buffer.from(text + '\0', 'utf8');
      blobParts.push(strBuf);
      blobOffset += strBuf.length;
    } else {
      // DLSTRINGS / ILSTRINGS: uint32 length + text + null
      const strBuf = Buffer.from(text + '\0', 'utf8');
      const lenBuf = Buffer.allocUnsafe(4);
      lenBuf.writeUInt32LE(strBuf.length, 0);
      blobParts.push(lenBuf, strBuf);
      blobOffset += 4 + strBuf.length;
    }
  }

  const blob = Buffer.concat(blobParts);
  const headerSize = 8 + items.length * 8;
  const out = Buffer.allocUnsafe(headerSize + blob.length);

  out.writeUInt32LE(items.length, 0);
  out.writeUInt32LE(blob.length, 4);

  for (let i = 0; i < items.length; i++) {
    const base = 8 + i * 8;
    out.writeUInt32LE(items[i].id, base);
    out.writeUInt32LE(offsets[i], base + 4);
  }

  blob.copy(out, headerSize);
  log.debug(`STRINGS: wrote ${type} buffer — ${items.length} entries, ${out.length} bytes`);
  return out;
}
