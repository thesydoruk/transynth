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
 */

import fs from 'fs';
import { inflateSync } from 'zlib';

const MAGIC = 'BTDX';
const TYPE_GNRL = 'GNRL';
const HEADER_SIZE = 24;
const ENTRY_SIZE = 36; // valid for both v1 and v8 GNRL format

export interface Ba2FileEntry {
  /** Archive-relative path, e.g. "Strings\mod_en.STRINGS" */
  name: string;
  /** 4-char extension from entry */
  ext: string;
  /** raw byte offset in the archive */
  offset: number;
  /** 0 = uncompressed */
  packedSize: number;
  unpackedSize: number;
}

export class Ba2Reader {
  private buf: Buffer;
  private entries: Ba2FileEntry[];
  private nameIndex: Map<string, Ba2FileEntry>;

  constructor(filePath: string) {
    this.buf = fs.readFileSync(filePath);
    this.entries = [];
    this.nameIndex = new Map();
    this.parse();
  }

  private parse(): void {
    const buf = this.buf;
    if (buf.length < HEADER_SIZE) throw new Error('BA2: file too small');

    const magic = buf.toString('ascii', 0, 4);
    if (magic !== MAGIC) throw new Error(`BA2: bad magic "${magic}"`);

    const archType = buf.toString('ascii', 8, 12).replace(/\0/g, '');
    if (archType !== TYPE_GNRL) {
      throw new Error(`BA2: unsupported archive type "${archType}" (only GNRL supported)`);
    }

    const fileCount = buf.readUInt32LE(12);
    const nameTableOffset = Number(buf.readBigUInt64LE(16));

    // Read name table
    const names: string[] = [];
    let ntPos = nameTableOffset;
    for (let i = 0; i < fileCount; i++) {
      const len = buf.readUInt16LE(ntPos);
      ntPos += 2;
      names.push(buf.toString('utf8', ntPos, ntPos + len));
      ntPos += len;
    }

    // Read file entries
    for (let i = 0; i < fileCount; i++) {
      const base = HEADER_SIZE + i * ENTRY_SIZE;
      const ext = buf.toString('ascii', base + 4, base + 8).replace(/\0/g, '');
      const offset = Number(buf.readBigUInt64LE(base + 16));
      const packedSize = buf.readUInt32LE(base + 24);
      const unpackedSize = buf.readUInt32LE(base + 28);

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

  /** List all file names in the archive. */
  listFiles(): string[] {
    return this.entries.map(e => e.name);
  }

  /** List files matching a given extension (case-insensitive), e.g. ".STRINGS" */
  listByExt(ext: string): Ba2FileEntry[] {
    const extLower = ext.toLowerCase().replace(/^\./, '');
    return this.entries.filter(e => e.name.toLowerCase().endsWith('.' + extLower));
  }

  /** Extract a file by its archive-relative path (case-insensitive). Returns null if not found. */
  extractByName(name: string): Buffer | null {
    const entry = this.nameIndex.get(name.toLowerCase().replace(/\//g, '\\'));
    if (!entry) return null;
    return this.extractEntry(entry);
  }

  /** Extract a file by entry object. */
  extractEntry(entry: Ba2FileEntry): Buffer {
    const { offset, packedSize, unpackedSize } = entry;
    const raw = this.buf.subarray(offset, offset + (packedSize || unpackedSize));

    if (packedSize > 0 && packedSize !== unpackedSize) {
      return inflateSync(raw);
    }
    return Buffer.from(raw); // copy to own buffer
  }

  get fileCount(): number {
    return this.entries.length;
  }
}
