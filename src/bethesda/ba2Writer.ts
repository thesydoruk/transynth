/**
 * ba2Writer.ts
 *
 * Writer for Bethesda Archive 2 (BA2) — GNRL type, version 1.
 * Creates a valid BA2 archive from a list of named file buffers.
 * Files are stored uncompressed for maximum compatibility.
 *
 * Binary layout matches ba2Reader.ts:
 *   Header (24 bytes):  magic "BTDX" + version(u32) + type "GNRL" + fileCount(u32) + nameTableOffset(u64)
 *   File entries (fileCount × 36 bytes):  nameHash(u32) + ext(4) + dirHash(u32) + unk(u32) + offset(u64) + packedSize(u32) + unpackedSize(u32) + align(u32)
 *   File data (sequentially)
 *   Name table: for each file uint16(length) + UTF-8 string
 */

import { log } from '../logger';

const MAGIC = 'BTDX';
const TYPE_GNRL = 'GNRL';
const HEADER_SIZE = 24;
const ENTRY_SIZE = 36;

/**
 * Input file descriptor used by {@link writeBa2}.
 *
 * Each entry becomes one file record in the BA2 name table and one contiguous
 * payload block in the data section.
 */
export interface Ba2InputFile {
  /** Archive-relative path, e.g. `"Strings\\mod_uk.STRINGS"`. */
  name: string;
  /** Raw file bytes to store in the archive (written uncompressed). */
  data: Buffer;
}

/* ── CRC-32 (IEEE 802.3) lookup table ── */
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
/**
 * Compute CRC‑32 (IEEE 802.3) checksum for a buffer.
 *
 * BA2 archives store hashes of directory and filename stems using this
 * algorithm. Only the lower 32 bits are used; the result is always
 * returned as an unsigned integer.
 *
 * @param buf - Buffer whose contents should be hashed.
 * @returns Unsigned 32‑bit CRC value.
 */
const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Split an archive-relative path into directory, stem, and extension.
 *
 * The path is normalised to lower-case and Windows-style separators so that
 * hash calculation matches the expectations of the Fallout 4 BA2 format.
 *
 * @param fullPath - Archive-relative path such as `"Strings\\MyMod_uk.STRINGS"`.
 * @returns Object containing `dir`, `stem`, and `ext` components.
 */
const pathParts = (fullPath: string): { dir: string; stem: string; ext: string } => {
  const normalized = fullPath.toLowerCase().replace(/\//g, '\\');
  const lastSep = normalized.lastIndexOf('\\');
  const dir = lastSep >= 0 ? normalized.substring(0, lastSep) : '';
  const filename = lastSep >= 0 ? normalized.substring(lastSep + 1) : normalized;
  const dotIdx = filename.lastIndexOf('.');
  const stem = dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
  const ext = dotIdx >= 0 ? filename.substring(dotIdx + 1) : '';
  return { dir, stem, ext };
}

/**
 * Build a BA2 (GNRL, version 1) archive buffer from a list of files.
 *
 * All files are stored uncompressed (`packedSize = 0`) to keep the archive
 * structure simple and avoid any compatibility differences between game
 * builds. This is sufficient for string-table archives where compression
 * gains are modest.
 *
 * @param files - Array of archive entries with relative name and raw data.
 * @returns Newly allocated buffer containing the complete BA2 archive.
 */
export const writeBa2 = (files: Ba2InputFile[]): Buffer => {
  const fileCount = files.length;
  const dataStart = HEADER_SIZE + fileCount * ENTRY_SIZE;

  // Layout file data sequentially after entries
  const offsets: number[] = [];
  let currentOffset = dataStart;
  for (const f of files) {
    offsets.push(currentOffset);
    currentOffset += f.data.length;
  }

  const nameTableOffset = currentOffset;

  // ── Header ──
  const header = Buffer.alloc(HEADER_SIZE);
  header.write(MAGIC, 0, 4, 'ascii');
  header.writeUInt32LE(1, 4); // version 1
  header.write(TYPE_GNRL, 8, 4, 'ascii');
  header.writeUInt32LE(fileCount, 12);
  header.writeBigUInt64LE(BigInt(nameTableOffset), 16);

  // ── File entries ──
  const entries = Buffer.alloc(fileCount * ENTRY_SIZE);
  for (let i = 0; i < fileCount; i++) {
    const base = i * ENTRY_SIZE;
    const { dir, stem, ext } = pathParts(files[i].name);

    entries.writeUInt32LE(crc32(Buffer.from(stem)), base);        // nameHash
    const extBuf = Buffer.alloc(4);
    Buffer.from(ext.substring(0, 4)).copy(extBuf);
    extBuf.copy(entries, base + 4);                               // ext (4 chars)
    entries.writeUInt32LE(crc32(Buffer.from(dir)), base + 8);     // dirHash
    entries.writeUInt32LE(0, base + 12);                          // unknown
    entries.writeBigUInt64LE(BigInt(offsets[i]), base + 16);       // offset
    entries.writeUInt32LE(0, base + 24);                          // packedSize (0 = uncompressed)
    entries.writeUInt32LE(files[i].data.length, base + 28);       // unpackedSize
    entries.writeUInt32LE(0, base + 32);                          // align
  }

  // ── Name table ──
  const nameParts: Buffer[] = [];
  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(nameBytes.length);
    nameParts.push(lenBuf, nameBytes);
  }

  const result = Buffer.concat([header, entries, ...files.map(f => f.data), ...nameParts]);
  log.info(`BA2: wrote archive with ${fileCount} files, ${result.length} bytes`);
  return result;
}
