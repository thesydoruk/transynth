/**
 * bsaReader.ts
 *
 * Reader for Bethesda Soft Archive (BSA) files.
 * Supports version 104 (Skyrim LE / TES5) and version 105 (Skyrim SE).
 *
 * BSA binary layout (all values little-endian):
 *
 *   Header (36 bytes):
 *     magic                 : char[4]  = "BSA\0"
 *     version               : uint32   — 104 (SLE) or 105 (SSE)
 *     folderRecordOffset    : uint32   = 36 (always)
 *     archiveFlags          : uint32   — bit 2 (0x04) = whole-archive default compression
 *     folderCount           : uint32
 *     fileCount             : uint32
 *     totalFolderNameLength : uint32   — sum of (folderName.length + 1) for all folders
 *     totalFileNameLength   : uint32   — sum of (fileName.length + 1) for all files
 *     contentFlags          : uint32   — indicates what content types are present
 *
 *   Folder records at offset 36, each:
 *     v104 (16 bytes): nameHash:uint64  fileCount:uint32  offset:uint32
 *     v105 (24 bytes): nameHash:uint64  fileCount:uint32  unk:uint32  offset:uint64
 *     The offset values contain an adjustment and are NOT used in this reader —
 *     we read folder data sequentially after the folder record block instead.
 *
 *   Folder data blocks (one per folder, in folder-record order):
 *     nameLen : uint8   — byte length of the folder name including the null terminator
 *     name    : char[nameLen]  — folder path in lowercase, e.g. "strings\0"
 *     N × File records (16 bytes each):
 *       nameHash    : uint64
 *       size        : uint32  — raw data size on disk; bits:
 *                               bit 29 (0x20000000) = "full path included in data" (rare)
 *                               bit 30 (0x40000000) = per-file compression toggle
 *                              lower 30 bits = actual byte count of data on disk
 *       offset      : uint32  — absolute byte offset to file data within the archive
 *
 *   File name table (totalFileNameLength bytes):
 *     Null-terminated file names (just basenames, no folder), in the same order as
 *     the file records encountered while walking the folder data blocks.
 *
 *   File data:
 *     If not compressed: raw file bytes.
 *     If compressed: uint32 unpackedSize + zlib-deflate data (inflate, not inflateRaw).
 *
 * Note on compression:
 *   A file is compressed when archiveCompressed XOR perFileToggle is true:
 *     archiveCompressed = (archiveFlags & 0x04) !== 0
 *     perFileToggle     = (fileRecord.size & 0x40000000) !== 0
 *     isCompressed      = archiveCompressed XOR perFileToggle
 */

import fs from 'fs';
import { inflateSync } from 'zlib';
// lz4js is a pure-JS LZ4 decoder — used for Skyrim SE (BSA v105) archives.
// We import it dynamically at the module level; the package provides a CommonJS
// default export with a `decompress(src, dest)` function.
import lz4 from 'lz4js';
import { log } from '../../logger';
import type { BsaFileEntry } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

const BSA_MAGIC = 'BSA\0';

/** Supported BSA versions: 104 = Skyrim LE (TES5), 105 = Skyrim SE (TES5SE). */
const SUPPORTED_VERSIONS = new Set([104, 105]);

const HEADER_SIZE = 36;

/** Folder record sizes differ between v104 (smaller offset) and v105 (64-bit offset). */
const FOLDER_RECORD_SIZE: Record<number, number> = { 104: 16, 105: 24 };
const FILE_RECORD_SIZE = 16;

/** Archive flag: all files are compressed by default. */
const ARCHIVE_FLAG_COMPRESSED = 0x04;

/**
 * Per-file compression toggle flag (bit 30).
 * When set, the file's compression state is the opposite of the archive default.
 */
const FILE_FLAG_COMPRESS_TOGGLE = 0x40000000;

/**
 * Size mask — lower 30 bits of the size field are the actual on-disk byte count.
 * Bits 30 and 31 are flag bits and must be masked off before using as a size.
 */
const FILE_SIZE_MASK = 0x3FFFFFFF;

// ── Reader ───────────────────────────────────────────────────────────────────

/**
 * Reader for Bethesda Soft Archive (BSA) files (Skyrim LE v104 and Skyrim SE v105).
 *
 * Reads the full archive into memory on construction.  Provides `listByExt()`
 * for filtering by file extension and `extractEntry()` for reading file data.
 *
 * Usage:
 * ```ts
 * const bsa = new BsaReader('/path/to/Mod.bsa');
 * for (const entry of bsa.listByExt('strings')) {
 *   const buf = bsa.extractEntry(entry);
 *   // ... parse strings file
 * }
 * ```
 */
export class BsaReader {
  /** Raw archive buffer — kept in memory for random-access extraction. */
  private readonly buf: Buffer;

  /** BSA format version: 104 or 105. */
  public readonly version: number;

  /** All parsed file entries, in folder-walk order. */
  private readonly entries: BsaFileEntry[];

  /** Case-insensitive name → entry map for O(1) lookup. */
  private readonly nameIndex: Map<string, BsaFileEntry>;

  /**
   * Open and parse a BSA archive file.
   *
   * @param filePath - Absolute path to the .bsa file.
   * @throws Error if the file is not a valid v104/v105 BSA archive.
   */
  constructor(filePath: string) {
    log.debug(`BSA: opening ${filePath}`);
    this.buf = fs.readFileSync(filePath);
    this.entries = [];
    this.nameIndex = new Map();
    this.version = this.buf.readUInt32LE(4);
    this.parse();
    log.info(`BSA: loaded ${this.entries.length} files from ${filePath}`);
  }

  // ── Parsing ────────────────────────────────────────────────────────────────

  /**
   * Parse the full BSA structure and populate `this.entries`.
   * Uses sequential reading rather than the per-folder offset fields because
   * Creation Kit always writes folders in the same order as the folder records.
   */
  private parse(): void {
    const buf = this.buf;

    if (buf.length < HEADER_SIZE) {
      throw new Error('BSA: file too small to be a valid archive');
    }

    // ── Header ────────────────────────────────────────────────────────────
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== BSA_MAGIC) {
      throw new Error(`BSA: bad magic "${magic}" — expected "BSA\\0"`);
    }

    const version = this.version;
    if (!SUPPORTED_VERSIONS.has(version)) {
      throw new Error(
        `BSA: unsupported version ${version} (supported: 104 = Skyrim LE, 105 = Skyrim SE)`,
      );
    }

    const archiveFlags = buf.readUInt32LE(12);
    const folderCount = buf.readUInt32LE(16);
    const fileCount = buf.readUInt32LE(20);
    const totalFileNameLength = buf.readUInt32LE(28);

    /** True when the archive uses zlib compression for files by default. */
    const archiveCompressed = (archiveFlags & ARCHIVE_FLAG_COMPRESSED) !== 0;

    const folderRecordSize = FOLDER_RECORD_SIZE[version];

    // ── Step 1: Read folder records — extract fileCount for each folder ──
    // We only need the fileCount field; the nameHash and offset are not used
    // in sequential mode.
    const folderFileCounts: number[] = [];
    let pos = HEADER_SIZE;

    for (let i = 0; i < folderCount; i++) {
      // Offset 8 within the folder record holds fileCount for both v104 and v105.
      folderFileCounts.push(buf.readUInt32LE(pos + 8));
      pos += folderRecordSize;
    }

    // ── Step 2: Read folder data blocks sequentially ────────────────────
    // After all folder records: folderCount × (bstring name + N × file records).
    // We collect raw file entries and folder names in walk order.
    const rawFileRecords: Array<{ rawSize: number; offset: number }> = [];
    const folderNames: string[] = [];

    for (let fi = 0; fi < folderCount; fi++) {
      // bstring: 1-byte length (includes the null terminator), then name bytes.
      const nameLen = buf.readUInt8(pos);
      pos += 1;
      // Decode folder name; strip null terminator.
      const folderName = buf.toString('ascii', pos, pos + nameLen).replace(/\0/g, '');
      pos += nameLen;
      folderNames.push(folderName.toLowerCase());

      // File records for this folder.
      const fc = folderFileCounts[fi];
      for (let j = 0; j < fc; j++) {
        // File record layout: nameHash(8) + size(4) + offset(4) = 16 bytes.
        const rawSize = buf.readUInt32LE(pos + 8);
        const dataOffset = buf.readUInt32LE(pos + 12);
        rawFileRecords.push({ rawSize, offset: dataOffset });
        pos += FILE_RECORD_SIZE;
      }
    }

    // ── Step 3: Read the file name table ────────────────────────────────
    // totalFileNameLength bytes of null-terminated file basenames, in the
    // same order as the rawFileRecords array we just built.
    const nameTableEnd = pos + totalFileNameLength;
    const fileNames: string[] = [];
    let namePos = pos;

    for (let i = 0; i < fileCount; i++) {
      const nullIdx = buf.indexOf(0, namePos);
      const end = nullIdx === -1 ? nameTableEnd : nullIdx;
      fileNames.push(buf.toString('ascii', namePos, end).toLowerCase());
      namePos = end + 1;
    }

    pos = nameTableEnd;
    void pos; // final position is the start of file data — not used further

    // ── Step 4: Assemble BsaFileEntry objects ────────────────────────────
    let fileIdx = 0;

    for (let fi = 0; fi < folderCount; fi++) {
      const folder = folderNames[fi];
      const fc = folderFileCounts[fi];

      for (let j = 0; j < fc; j++) {
        const rec = rawFileRecords[fileIdx];
        const fname = fileNames[fileIdx] ?? '';
        fileIdx++;

        // Compression: archive default XOR per-file toggle.
        const perFileToggle = (rec.rawSize & FILE_FLAG_COMPRESS_TOGGLE) !== 0;
        const isCompressed = archiveCompressed !== perFileToggle;
        const dataSize = rec.rawSize & FILE_SIZE_MASK;

        const fullPath = folder ? `${folder}\\${fname}` : fname;

        const entry: BsaFileEntry = {
          name: fullPath,
          dataOffset: rec.offset,
          dataSize,
          isCompressed,
        };

        this.entries.push(entry);
        this.nameIndex.set(fullPath, entry);
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Return all entries whose file name ends with `.{ext}` (case-insensitive).
   *
   * @param ext - Extension without the leading dot, e.g. `"strings"`.
   */
  listByExt(ext: string): BsaFileEntry[] {
    const suffix = '.' + ext.toLowerCase();
    return this.entries.filter((e) => e.name.endsWith(suffix));
  }

  /**
   * Extract an entry and return its raw (decompressed) bytes.
   *
   * @param entry - An entry previously returned by `listByExt()` or `list()`.
   * @throws Error if decompression fails.
   */
  extractEntry(entry: BsaFileEntry): Buffer {
    const buf = this.buf;

    if (entry.isCompressed) {
      // Compressed layout depends on the BSA version:
      //   v104 (Skyrim LE): [uint32 original_size][zlib deflate data]
      //   v105 (Skyrim SE): [uint32 original_size][LZ4 block data]
      const unpackedSize = buf.readUInt32LE(entry.dataOffset);
      const compressedData = buf.subarray(
        entry.dataOffset + 4,
        entry.dataOffset + entry.dataSize,
      );

      let result: Buffer;
      if (this.version === 105) {
        // Skyrim SE uses LZ4 frame/block compression.
        const dest = Buffer.alloc(unpackedSize);
        const decoded = lz4.decompress(compressedData, dest) as number;
        result = dest.subarray(0, decoded);
      } else {
        // Skyrim LE uses standard zlib deflate.
        result = inflateSync(compressedData);
      }

      if (result.length !== unpackedSize) {
        log.warn(
          `BSA: decompressed size mismatch for "${entry.name}": expected ${unpackedSize}, got ${result.length}`,
        );
      }
      return result;
    } else {
      // Uncompressed: slice the buffer directly, copy to detach from parent.
      return Buffer.from(
        buf.subarray(entry.dataOffset, entry.dataOffset + entry.dataSize),
      );
    }
  }

  /**
   * Return a snapshot of all file entries in the archive.
   */
  list(): BsaFileEntry[] {
    return [...this.entries];
  }
}
