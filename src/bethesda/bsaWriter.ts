/**
 * bsaWriter.ts
 *
 * Writer for Bethesda Soft Archive (BSA) — version 105 (Skyrim SE).
 * Creates a valid BSA archive from a list of named file buffers.
 * Files are stored **uncompressed** for maximum compatibility.
 *
 * Binary layout matches bsaReader.ts:
 *
 *   Header (36 bytes):
 *     magic                 : char[4]  = "BSA\0"
 *     version               : uint32   = 105
 *     folderRecordOffset    : uint32   = 36
 *     archiveFlags          : uint32   = 0x03 (hasDirectoryNames | hasFileNames)
 *     folderCount           : uint32
 *     fileCount             : uint32
 *     totalFolderNameLength : uint32
 *     totalFileNameLength   : uint32
 *     contentFlags          : uint32   = 0 (generic)
 *
 *   Folder records (folderCount × 24 bytes each for v105):
 *     nameHash  : uint64
 *     fileCount : uint32
 *     unk       : uint32  = 0
 *     offset    : uint64  — byte offset to the folder's data block from the
 *                           start of the file (includes totalFileNameLength
 *                           adjustment per Bethesda convention)
 *
 *   Folder data blocks (one per folder, in folder-record order):
 *     nameLen : uint8   — byte length of folder name including null terminator
 *     name    : char[nameLen] — lower-case folder path with trailing \0
 *     N × File records (16 bytes each):
 *       nameHash : uint64 — Bethesda hash of the file basename (no folder, no ext)
 *       size     : uint32 — data size on disk (uncompressed, no flag bits set)
 *       offset   : uint32 — absolute byte offset to file data
 *
 *   File name table:
 *     Null-terminated file basenames in folder-walk order.
 *
 *   File data:
 *     Raw file bytes, concatenated in folder-walk order.
 */

import { log } from '../logger.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

const BSA_MAGIC = 'BSA\0';
const BSA_VERSION = 105;           // Skyrim SE
const HEADER_SIZE = 36;
const FOLDER_RECORD_SIZE = 24;     // v105: 8 + 4 + 4 + 8
const FILE_RECORD_SIZE = 16;       // 8 + 4 + 4

/**
 * Archive flags:
 *   bit 0 (0x01) = includes directory names
 *   bit 1 (0x02) = includes file names
 * We always set both so that consumers can discover paths.
 */
const ARCHIVE_FLAGS = 0x03;

/* ── Public types ────────────────────────────────────────────────────────── */

export interface BsaInputFile {
  /** Archive-relative path, e.g. "Strings\\ModName_uk.STRINGS" */
  name: string;
  /** Raw file content */
  data: Buffer;
}

/* ── Bethesda hash helpers ───────────────────────────────────────────────── */

/**
 * Compute the Bethesda hash for a file **name** (basename without extension).
 *
 * Algorithm (from UESP wiki — BSA format):
 *   1. Take the lowercased file name.
 *   2. hash1 = len<<1 | name.charCodeAt(len-1)<<24 | name.charCodeAt(0) |
 *              (len >= 3 ? name.charCodeAt(len-2)<<16 : 0)
 *   3. hash2 = CRC of name[1..(len-2)] using Bethesda table
 *   4. hash3 = CRC of extension using Bethesda table
 *   5. result = (hash2 + hash3) << 32 | hash1
 */
const bethesdaHashFile = (stem: string, ext: string): bigint => {
  const name = stem.toLowerCase();
  const extLow = ext.toLowerCase();
  const len = name.length;

  // ── hash1 ──
  let hash1 =
    ((len & 0xff) << 0) |
    (len > 0 ? (name.charCodeAt(len - 1) & 0xff) << 24 : 0) |
    (len > 0 ? (name.charCodeAt(0) & 0xff) << 8 : 0) |
    (len >= 3 ? (name.charCodeAt(len - 2) & 0xff) << 16 : 0);
  hash1 = hash1 >>> 0; // force unsigned 32-bit

  // ── hash2: CRC of middle chars (index 1 to len-2) ──
  let hash2 = 0;
  for (let i = 1; i < len - 2; i++) {
    hash2 = ((hash2 * 0x1003f) + name.charCodeAt(i)) >>> 0;
  }

  // ── hash3: CRC of extension ──
  let hash3 = 0;
  for (let i = 0; i < extLow.length; i++) {
    hash3 = ((hash3 * 0x1003f) + extLow.charCodeAt(i)) >>> 0;
  }

  // Known extension adjustments (shifts hash1)
  if (extLow === '.strings' || extLow === '.dlstrings' || extLow === '.ilstrings') {
    // No standard BSA extension bonus for strings files — those aren't in the
    // vanilla list (.nif, .kf, .dds, .wav).  Leave hash1 unchanged.
  }

  const upper = BigInt((hash2 + hash3) >>> 0);
  const lower = BigInt(hash1);
  return (upper << 32n) | lower;
};

/**
 * Compute Bethesda hash for a **folder** path.
 *
 * Algorithm (from UESP wiki — BSA format):
 *   Same structure as the file name hash but with an empty extension.
 *   The folder path uses backslash separators and is lowercased.
 */
const bethesdaHashFolder = (folder: string): bigint => {
  const name = folder.toLowerCase().replace(/\//g, '\\');
  const len = name.length;

  let hash1 =
    ((len & 0xff) << 0) |
    (len > 0 ? (name.charCodeAt(len - 1) & 0xff) << 24 : 0) |
    (len > 0 ? (name.charCodeAt(0) & 0xff) << 8 : 0) |
    (len >= 3 ? (name.charCodeAt(len - 2) & 0xff) << 16 : 0);
  hash1 = hash1 >>> 0;

  let hash2 = 0;
  for (let i = 1; i < len - 2; i++) {
    hash2 = ((hash2 * 0x1003f) + name.charCodeAt(i)) >>> 0;
  }

  return (BigInt(hash2) << 32n) | BigInt(hash1);
};

/* ── Internal grouping types ─────────────────────────────────────────────── */

interface FileEntry {
  /** Lowercase basename without folder, e.g. "modname_uk.strings" */
  baseName: string;
  /** Lowercase stem (no ext), e.g. "modname_uk" */
  stem: string;
  /** Extension with dot, e.g. ".strings" */
  ext: string;
  /** Name hash for the file record */
  nameHash: bigint;
  /** Raw file data */
  data: Buffer;
}

interface FolderGroup {
  /** Lowercase folder path with backslashes, e.g. "strings" */
  folderPath: string;
  /** Hash of the folder path */
  folderHash: bigint;
  /** Files belonging to this folder */
  files: FileEntry[];
}

/* ── Path splitting helper ───────────────────────────────────────────────── */

/**
 * Split an archive-relative path into folder and file parts.
 *
 * @param fullPath - e.g. "Strings\\ModName_uk.STRINGS"
 * @returns folder (lowercased, backslash-separated) and file parts
 */
const splitPath = (fullPath: string): { folder: string; baseName: string; stem: string; ext: string } => {
  const normalized = fullPath.toLowerCase().replace(/\//g, '\\');
  const lastSep = normalized.lastIndexOf('\\');
  const folder = lastSep >= 0 ? normalized.substring(0, lastSep) : '';
  const baseName = lastSep >= 0 ? normalized.substring(lastSep + 1) : normalized;
  const dotIdx = baseName.lastIndexOf('.');
  const stem = dotIdx >= 0 ? baseName.substring(0, dotIdx) : baseName;
  const ext = dotIdx >= 0 ? baseName.substring(dotIdx) : '';
  return { folder, baseName, stem, ext };
};

/* ── Writer ──────────────────────────────────────────────────────────────── */

/**
 * Build a BSA (version 105, Skyrim SE) archive buffer from a list of files.
 * Files are stored **uncompressed** (archive flag bit 2 is not set).
 *
 * @param files - Array of named file buffers to pack.
 * @returns A Buffer containing the complete BSA archive.
 */
export const writeBsa = (files: BsaInputFile[]): Buffer => {
  if (files.length === 0) {
    throw new Error('BSA writer: cannot create an empty archive');
  }

  // ── Step 1: Group files by folder and sort ────────────────────────────
  const folderMap = new Map<string, FileEntry[]>();

  for (const f of files) {
    const { folder, baseName, stem, ext } = splitPath(f.name);
    const nameHash = bethesdaHashFile(stem, ext);
    const entry: FileEntry = { baseName, stem, ext, nameHash, data: f.data };

    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push(entry);
  }

  // Sort folders by hash (BSA specification requires hash-sorted folder records)
  const folders: FolderGroup[] = [...folderMap.entries()]
    .map(([folderPath, fileEntries]) => ({
      folderPath,
      folderHash: bethesdaHashFolder(folderPath),
      files: fileEntries.sort((a, b) => {
        // Sort files within each folder by hash
        if (a.nameHash < b.nameHash) return -1;
        if (a.nameHash > b.nameHash) return 1;
        return 0;
      }),
    }))
    .sort((a, b) => {
      if (a.folderHash < b.folderHash) return -1;
      if (a.folderHash > b.folderHash) return 1;
      return 0;
    });

  const folderCount = folders.length;
  const fileCount = files.length;

  // ── Step 2: Compute layout sizes ──────────────────────────────────────

  // totalFolderNameLength: sum of (folderName.length + 1) for each folder
  // The +1 accounts for the null terminator; the bstring length byte is separate.
  let totalFolderNameLength = 0;
  for (const folder of folders) {
    totalFolderNameLength += folder.folderPath.length + 1; // +1 for \0
  }

  // totalFileNameLength: sum of (baseName.length + 1) for each file
  let totalFileNameLength = 0;
  for (const folder of folders) {
    for (const f of folder.files) {
      totalFileNameLength += f.baseName.length + 1; // +1 for \0
    }
  }

  // Region sizes
  const folderRecordsSize = folderCount * FOLDER_RECORD_SIZE;
  const folderDataSize = folders.reduce((acc, folder) => {
    // bstring: 1 byte (length) + folderName.length + 1 (\0) + N × FILE_RECORD_SIZE
    return acc + 1 + folder.folderPath.length + 1 + folder.files.length * FILE_RECORD_SIZE;
  }, 0);

  const folderRecordsOffset = HEADER_SIZE;
  const folderDataOffset = folderRecordsOffset + folderRecordsSize;
  const fileNameTableOffset = folderDataOffset + folderDataSize;
  const fileDataOffset = fileNameTableOffset + totalFileNameLength;

  // ── Step 3: Compute absolute file data offsets ────────────────────────
  // Lay out file data sequentially after the name table, in folder-walk order.
  const fileDataOffsets: number[] = [];
  let dataPos = fileDataOffset;
  for (const folder of folders) {
    for (const f of folder.files) {
      fileDataOffsets.push(dataPos);
      dataPos += f.data.length;
    }
  }

  const totalSize = dataPos;

  // ── Step 4: Build the buffer ──────────────────────────────────────────
  const buf = Buffer.alloc(totalSize);
  let pos = 0;

  // ── Header (36 bytes) ──
  buf.write(BSA_MAGIC, 0, 4, 'ascii');
  buf.writeUInt32LE(BSA_VERSION, 4);
  buf.writeUInt32LE(HEADER_SIZE, 8);          // folderRecordOffset (always 36)
  buf.writeUInt32LE(ARCHIVE_FLAGS, 12);       // archiveFlags
  buf.writeUInt32LE(folderCount, 16);
  buf.writeUInt32LE(fileCount, 20);
  buf.writeUInt32LE(totalFolderNameLength, 24);
  buf.writeUInt32LE(totalFileNameLength, 28);
  buf.writeUInt32LE(0, 32);                   // contentFlags (generic)
  pos = HEADER_SIZE;

  // ── Folder records ──
  // Per BSA convention, the offset stored in each folder record points to the
  // folder's data block and has totalFileNameLength added to it.
  let folderDataPos = folderDataOffset;
  for (const folder of folders) {
    buf.writeBigUInt64LE(folder.folderHash, pos);           // nameHash (uint64)
    pos += 8;
    buf.writeUInt32LE(folder.files.length, pos);            // fileCount
    pos += 4;
    buf.writeUInt32LE(0, pos);                              // unk (padding for v105)
    pos += 4;
    // offset: absolute position of this folder's data block + totalFileNameLength
    const adjustedOffset = folderDataPos + totalFileNameLength;
    buf.writeBigUInt64LE(BigInt(adjustedOffset), pos);      // offset (uint64 for v105)
    pos += 8;

    // Advance folderDataPos past this folder's data block
    folderDataPos += 1 + folder.folderPath.length + 1 + folder.files.length * FILE_RECORD_SIZE;
  }

  // ── Folder data blocks ──
  let fileIdx = 0;
  for (const folder of folders) {
    // bstring: length byte (includes null terminator)
    const nameWithNull = folder.folderPath + '\0';
    buf.writeUInt8(nameWithNull.length, pos);
    pos += 1;
    buf.write(nameWithNull, pos, nameWithNull.length, 'ascii');
    pos += nameWithNull.length;

    // File records for this folder
    for (const f of folder.files) {
      buf.writeBigUInt64LE(f.nameHash, pos);                // nameHash
      pos += 8;
      buf.writeUInt32LE(f.data.length, pos);                // size (uncompressed, no flags)
      pos += 4;
      buf.writeUInt32LE(fileDataOffsets[fileIdx], pos);      // absolute offset
      pos += 4;
      fileIdx++;
    }
  }

  // ── File name table ──
  for (const folder of folders) {
    for (const f of folder.files) {
      const nameWithNull = f.baseName + '\0';
      buf.write(nameWithNull, pos, nameWithNull.length, 'ascii');
      pos += nameWithNull.length;
    }
  }

  // ── File data ──
  fileIdx = 0;
  for (const folder of folders) {
    for (const f of folder.files) {
      f.data.copy(buf, fileDataOffsets[fileIdx]);
      fileIdx++;
    }
  }

  log.info(`BSA: wrote v${BSA_VERSION} archive with ${fileCount} files in ${folderCount} folders, ${totalSize} bytes`);
  return buf;
};
