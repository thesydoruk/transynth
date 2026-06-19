/**
 * ba2Reader.ts
 *
 * Reader for Bethesda Archive 2 (BA2) files — GNRL (General) type only.
 * Supports versions 1 (Fallout 4 original) and 8 (Fallout 4 NG / Updated).
 *
 * Binary layout:
 *   Header (24 bytes):
 *     magic           : char[4]  = "BTDX"
 *     version         : uint32   — 1 (FO4) or 8 (FO4 NG)
 *     type            : char[4]  = "GNRL"
 *     fileCount       : uint32
 *     nameTableOffset : uint64
 *
 *   File entries (fileCount × 36 bytes each):
 *     nameHash    : uint32
 *     ext         : char[4]
 *     dirHash     : uint32
 *     unknown     : uint32
 *     offset      : uint64   — byte offset of file data within archive
 *     packedSize  : uint32   — 0 = uncompressed; >0 = zlib compressed
 *     unpackedSize: uint32
 *     align       : uint32
 *
 *   Name table (at nameTableOffset):
 *     For each file: uint16 length + UTF-8 string (no null terminator)
 *
 * File data:
 *   If packedSize == 0: raw bytes of length unpackedSize
 *   If packedSize > 0: zlib-deflate compressed bytes (use inflateRaw / inflate)
 *
 * Large archives (>2 GiB) are indexed via a file descriptor; only requested
 * entry payloads are read into memory.
 */

import fs from 'fs';
import { inflateSync } from 'zlib';
import { log } from '../../logger';
import type { Ba2FileEntry } from '../types';
import { BA2_MAGIC, BA2_TYPE_GNRL, BA2_HEADER_SIZE, BA2_ENTRY_SIZE } from './ba2Constants';

const HEADER_SIZE = BA2_HEADER_SIZE;
const ENTRY_SIZE = BA2_ENTRY_SIZE; // valid for both v1 and v8 GNRL format

const readAt = (fd: number, offset: number, length: number): Buffer => {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, offset + read);
    if (n <= 0) throw new Error(`BA2: unexpected EOF at offset ${offset + read}`);
    read += n;
  }
  return buf;
};

/**
 * Reader for Bethesda BA2 (GNRL) archives used by Fallout 4 / 76.
 *
 * The reader parses the archive index from disk and reads individual entries
 * on demand, so multi-gigabyte archives (e.g. vanilla `Fallout4 - Voices.ba2`)
 * can be opened without hitting Node's ~2 GiB Buffer limit.
 *
 * Typical usage:
 *
 * ```ts
 * const ba2 = new Ba2Reader('MyMod - Main.ba2');
 * for (const entry of ba2.listByExt('.STRINGS')) {
 *   const buf = ba2.extractEntry(entry);
 *   // ... pass buf to parseStringsBuffer()
 * }
 * ba2.close();
 * ```
 */
export class Ba2Reader {
  private fd = -1;
  private fileSize = 0;
  private entries: Ba2FileEntry[];
  private nameIndex: Map<string, Ba2FileEntry>;

  /**
   * Open and parse a BA2 archive from disk.
   *
   * @param filePath - Absolute or relative path to the `.ba2` file.
   * @throws Error when the file is not a valid BA2 GNRL archive.
   */
  constructor(filePath: string) {
    log.debug(`BA2: opening ${filePath}`);
    const stat = fs.statSync(filePath);
    this.fileSize = stat.size;
    this.fd = fs.openSync(filePath, 'r');
    this.entries = [];
    this.nameIndex = new Map();
    try {
      this.parse();
      log.info(`BA2: loaded ${this.entries.length} files from ${filePath}`);
    } catch (err) {
      this.close();
      throw err;
    }
  }

  /**
   * Parse the BA2 header, file table, and name table.
   *
   * Populates `this.entries` and the case-insensitive name index used by
   * `extractByName()`. The method assumes the archive uses the GNRL layout
   * described in the module header comment.
   */
  private parse(): void {
    if (this.fileSize < HEADER_SIZE) throw new Error('BA2: file too small');

    const header = readAt(this.fd, 0, HEADER_SIZE);

    const magic = header.toString('ascii', 0, 4);
    if (magic !== BA2_MAGIC) throw new Error(`BA2: bad magic "${magic}"`);

    const archType = header.toString('ascii', 8, 12).replace(/\0/g, '');
    if (archType !== BA2_TYPE_GNRL) {
      throw new Error(`BA2: unsupported archive type "${archType}" (only GNRL supported)`);
    }

    const fileCount = header.readUInt32LE(12);
    const nameTableOffset = Number(header.readBigUInt64LE(16));

    if (nameTableOffset < HEADER_SIZE || nameTableOffset >= this.fileSize) {
      throw new Error('BA2: invalid name table offset');
    }

    const entriesBuf = readAt(this.fd, HEADER_SIZE, fileCount * ENTRY_SIZE);
    const nameTableSize = this.fileSize - nameTableOffset;
    const nameTableBuf = readAt(this.fd, nameTableOffset, nameTableSize);

    const names: string[] = [];
    let ntPos = 0;
    for (let i = 0; i < fileCount; i++) {
      if (ntPos + 2 > nameTableBuf.length) {
        throw new Error('BA2: truncated name table');
      }
      const len = nameTableBuf.readUInt16LE(ntPos);
      ntPos += 2;
      if (ntPos + len > nameTableBuf.length) {
        throw new Error('BA2: truncated name table entry');
      }
      names.push(nameTableBuf.toString('utf8', ntPos, ntPos + len));
      ntPos += len;
    }

    for (let i = 0; i < fileCount; i++) {
      const base = i * ENTRY_SIZE;
      const ext = entriesBuf.toString('ascii', base + 4, base + 8).replace(/\0/g, '');
      const offset = Number(entriesBuf.readBigUInt64LE(base + 16));
      const packedSize = entriesBuf.readUInt32LE(base + 24);
      const unpackedSize = entriesBuf.readUInt32LE(base + 28);

      const entry: Ba2FileEntry = {
        name: names[i] ?? '',
        ext,
        offset,
        packedSize,
        unpackedSize,
      };
      this.entries.push(entry);
      this.nameIndex.set(names[i]?.toLowerCase() ?? '', entry);
    }
  }

  /**
   * List all file names in the archive.
   *
   * @returns An array of archive-relative paths.
   */
  listFiles(): string[] {
    return this.entries.map((e) => e.name);
  }

  /**
   * List all entries whose name ends with the given extension.
   *
   * The comparison is case-insensitive and the leading dot in `ext` is
   * optional.
   *
   * @param ext - File extension to match, with or without a leading dot.
   * @returns Matching {@link Ba2FileEntry} objects.
   */
  listByExt(ext: string): Ba2FileEntry[] {
    const extLower = ext.toLowerCase().replace(/^\./, '');
    return this.entries.filter((e) => e.name.toLowerCase().endsWith('.' + extLower));
  }

  /**
   * Extract a file by its archive-relative path.
   *
   * Lookup is case-insensitive and normalises forward slashes to backslashes
   * to match the on-disk convention used by BA2 archives.
   *
   * @param name - Archive-relative path, e.g. `"Strings\\MyMod_uk.STRINGS"`.
   * @returns A new {@link Buffer} with the (optionally decompressed) contents,
   *          or `null` when the file does not exist in the archive.
   */
  extractByName(name: string): Buffer | null {
    const entry = this.nameIndex.get(name.toLowerCase().replace(/\//g, '\\'));
    if (!entry) return null;
    return this.extractEntry(entry);
  }

  /**
   * Extract a file given its entry descriptor.
   *
   * When `packedSize > 0` and the packed and unpacked sizes differ, the
   * payload is assumed to be zlib-compressed and is decompressed on the fly.
   * Otherwise, the raw on-disk bytes are returned.
   *
   * @param entry - Entry previously obtained from `listFiles()` / `listByExt()`.
   * @returns A new {@link Buffer} containing the extracted (and possibly
   *          decompressed) file data.
   */
  extractEntry(entry: Ba2FileEntry): Buffer {
    const { offset, packedSize, unpackedSize } = entry;
    const rawLength = packedSize || unpackedSize;
    const raw = readAt(this.fd, offset, rawLength);

    if (packedSize > 0 && packedSize !== unpackedSize) {
      log.trace(`BA2: decompressing ${entry.name} (${packedSize} → ${unpackedSize} bytes)`);
      return inflateSync(raw);
    }
    return raw;
  }

  /** Release the underlying file descriptor. Safe to call more than once. */
  close(): void {
    if (this.fd >= 0) {
      fs.closeSync(this.fd);
      this.fd = -1;
    }
  }

  /**
   * Number of file entries stored in the archive.
   */
  get fileCount(): number {
    return this.entries.length;
  }
}
