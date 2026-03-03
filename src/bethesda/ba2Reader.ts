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
import { log } from '../logger.js';

const MAGIC = 'BTDX';
const TYPE_GNRL = 'GNRL';
const HEADER_SIZE = 24;
const ENTRY_SIZE = 36; // valid for both v1 and v8 GNRL format

/**
 * A single file entry in a BA2 archive.
 *
 * This mirrors the on-disk metadata for the GNRL format and is kept small on
 * purpose so that higher-level code can decide how to interpret the payload.
 */
export interface Ba2FileEntry {
  /** Archive-relative path, e.g. `"Strings\\mod_en.STRINGS"`. */
  name: string;
  /** Four-character extension from the entry header (already trimmed). */
  ext: string;
  /** Raw byte offset of the file data within the archive. */
  offset: number;
  /**
   * Packed byte length on disk.
   *
   * When `0`, the entry is stored uncompressed and `unpackedSize` is used
   * instead. When `> 0`, the entry payload is zlib-compressed.
   */
  packedSize: number;
  /** Expected uncompressed payload size in bytes. */
  unpackedSize: number;
}

/**
 * Reader for Bethesda BA2 (GNRL) archives used by Fallout 4 / 76.
 *
 * The reader loads the entire archive into memory and exposes a small API for
 * listing contained files and extracting individual entries, automatically
 * handling (optional) zlib compression.
 *
 * Typical usage:
 *
 * ```ts
 * const ba2 = new Ba2Reader('MyMod - Main.ba2');
 * for (const entry of ba2.listByExt('.STRINGS')) {
 *   const buf = ba2.extractEntry(entry);
 *   // ... pass buf to parseStringsBuffer()
 * }
 * ```
 */
export class Ba2Reader {
  private buf: Buffer;
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
    this.buf = fs.readFileSync(filePath);
    this.entries = [];
    this.nameIndex = new Map();
    this.parse();
    log.info(`BA2: loaded ${this.entries.length} files from ${filePath}`);
  }

  /**
   * Parse the BA2 header, file table, and name table.
   *
   * Populates `this.entries` and the case-insensitive name index used by
   * `extractByName()`. The method assumes the archive uses the GNRL layout
   * described in the module header comment.
   */
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

  /**
   * List all file names in the archive.
   *
   * @returns An array of archive-relative paths.
   */
  listFiles(): string[] {
    return this.entries.map(e => e.name);
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
    return this.entries.filter(e => e.name.toLowerCase().endsWith('.' + extLower));
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
    const raw = this.buf.subarray(offset, offset + (packedSize || unpackedSize));

    if (packedSize > 0 && packedSize !== unpackedSize) {
      log.trace(`BA2: decompressing ${entry.name} (${packedSize} → ${unpackedSize} bytes)`);
      return inflateSync(raw);
    }
    return Buffer.from(raw); // copy to own buffer
  }

  /**
   * Number of file entries stored in the archive.
   */
  get fileCount(): number {
    return this.entries.length;
  }
}
