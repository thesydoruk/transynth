/**
 * BsaWriter.ts
 *
 * Writer for Bethesda Soft Archive (BSA) — version 104 (Skyrim LE) and
 * version 105 (Skyrim SE).  Creates a valid BSA archive from a list of
 * named file buffers.  Files are stored **uncompressed** for maximum
 * compatibility.
 *
 * Binary layout matches bsaReader.ts:
 *
 *   Header (36 bytes):
 *     magic                 : char[4]  = "BSA\0"
 *     version               : uint32   = 104 or 105
 *     folderRecordOffset    : uint32   = 36
 *     archiveFlags          : uint32   = 0x03 (hasDirectoryNames | hasFileNames)
 *     folderCount           : uint32
 *     fileCount             : uint32
 *     totalFolderNameLength : uint32
 *     totalFileNameLength   : uint32
 *     contentFlags          : uint32   = 0 (generic)
 *
 *   Folder records (folderCount × N bytes each):
 *     v104: 16 bytes — nameHash(uint64) + fileCount(uint32) + offset(uint32)
 *     v105: 24 bytes — nameHash(uint64) + fileCount(uint32) + unk(uint32) + offset(uint64)
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

import { log } from '../../logger';
import type { ArchiveInputFile } from '../types';
import { packBsaFilePayload } from './bsaPayload';

/* ── Constants ───────────────────────────────────────────────────────────── */

const BSA_MAGIC = 'BSA\0';
const HEADER_SIZE = 36;
const FILE_RECORD_SIZE = 16; // 8 + 4 + 4

/** Folder record size differs between versions. */
const FOLDER_RECORD_SIZE: Record<number, number> = {
  104: 16, // uint64 hash + uint32 fileCount + uint32 offset
  105: 24, // uint64 hash + uint32 fileCount + uint32 unk + uint64 offset
};

/**
 * Archive flags:
 *   bit 0 (0x01) = includes directory names
 *   bit 1 (0x02) = includes file names
 * We always set both so that consumers can discover paths.
 */
const ARCHIVE_FLAGS = 0x03;

/* ── Bethesda hash helpers ───────────────────────────────────────────────── */

/**
 * Compute the Bethesda BSA hash for a file entry.
 *
 * The BSA format stores file records in hash order (per-folder). The hash is a
 * 64-bit value composed from:
 * - a 32-bit "lower" word derived from filename length and edge characters,
 * - and a 32-bit "upper" word derived from a rolling hash over the middle of
 *   the stem and the extension.
 *
 * This implementation follows the commonly documented algorithm used by
 * Bethesda tooling and matches the reader's expectations.
 *
 * @param stem - File basename without the extension (already lowercased by caller).
 * @param ext - File extension including the dot (e.g. `.strings`).
 * @returns 64-bit hash as a {@link bigint}.
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
    hash2 = (hash2 * 0x1003f + name.charCodeAt(i)) >>> 0;
  }

  // ── hash3: CRC of extension ──
  let hash3 = 0;
  for (let i = 0; i < extLow.length; i++) {
    hash3 = (hash3 * 0x1003f + extLow.charCodeAt(i)) >>> 0;
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
 * Compute the Bethesda BSA hash for a folder path.
 *
 * Folder records in the BSA header are also ordered by hash. The folder hash
 * uses the same structure as the file hash but does not include an extension.
 *
 * @param folder - Folder path within the archive (e.g. `strings`), any separators.
 * @returns 64-bit hash as a {@link bigint}.
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
    hash2 = (hash2 * 0x1003f + name.charCodeAt(i)) >>> 0;
  }

  return (BigInt(hash2) << 32n) | BigInt(hash1);
};

/* ── Internal grouping types ─────────────────────────────────────────────── */

/**
 * Internal normalised representation of an input file for BSA packing.
 *
 * This keeps precomputed hashes and canonicalised name parts so that later
 * layout steps can be performed without re-parsing paths.
 */
interface FileEntry {
  /** Lowercase basename without folder, e.g. "modname_uk.strings" */
  baseName: string;
  /** Lowercase stem (no ext), e.g. "modname_uk" */
  stem: string;
  /** Extension with dot, e.g. ".strings" */
  ext: string;
  /** Name hash for the file record */
  nameHash: bigint;
  /** On-disk bytes (raw or compressed payload) */
  data: Buffer;
  /** BSA file record size field */
  sizeField: number;
}

/**
 * Internal grouping of files by their folder path.
 *
 * BSA archives are structured as a list of folder records followed by per-folder
 * file record blocks. Both folders and files must be sorted by their Bethesda
 * hashes for maximum compatibility with consumers.
 */
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
 * This normalises the path for BSA rules:
 * - lower-case names,
 * - backslash separators,
 * - extension preserved with the leading dot.
 *
 * @param fullPath - Archive-relative path, e.g. `"Strings\\ModName_uk.STRINGS"`.
 * @returns Object containing normalised folder, basename, stem, and extension.
 */
const splitPath = (
  fullPath: string,
): { folder: string; baseName: string; stem: string; ext: string } => {
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
 * Build a BSA archive buffer from a list of files.
 *
 * @param files   - Array of named file buffers to pack.
 * @param version - BSA version: 104 (Skyrim LE) or 105 (Skyrim SE, default).
 *                  The only structural difference is folder record size:
 *                  v104 uses 16-byte records with uint32 offset,
 *                  v105 uses 24-byte records with uint32 padding + uint64 offset.
 * @returns A Buffer containing the complete BSA archive.
 */
export const writeBsa = (files: ArchiveInputFile[], version: number = 105): Buffer => {
  if (files.length === 0) {
    throw new Error('BSA writer: cannot create an empty archive');
  }
  if (version !== 104 && version !== 105) {
    throw new Error(`BSA writer: unsupported version ${version} (expected 104 or 105)`);
  }

  const folderRecordSize = FOLDER_RECORD_SIZE[version];

  // ── Step 1: Group files by folder and sort ────────────────────────────
  const folderMap = new Map<string, FileEntry[]>();

  for (const f of files) {
    const { folder, baseName, stem, ext } = splitPath(f.name);
    const nameHash = bethesdaHashFile(stem, ext);
    const packed = packBsaFilePayload(f.data, f.compressed === true, version);
    const entry: FileEntry = {
      baseName,
      stem,
      ext,
      nameHash,
      data: packed.data,
      sizeField: packed.sizeField,
    };

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
  const folderRecordsSize = folderCount * folderRecordSize;
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
  let pos = HEADER_SIZE;

  // ── Header (36 bytes) ──
  buf.write(BSA_MAGIC, 0, 4, 'ascii');
  buf.writeUInt32LE(version, 4);
  buf.writeUInt32LE(HEADER_SIZE, 8); // folderRecordOffset (always 36)
  buf.writeUInt32LE(ARCHIVE_FLAGS, 12); // archiveFlags
  buf.writeUInt32LE(folderCount, 16);
  buf.writeUInt32LE(fileCount, 20);
  buf.writeUInt32LE(totalFolderNameLength, 24);
  buf.writeUInt32LE(totalFileNameLength, 28);
  buf.writeUInt32LE(0, 32); // contentFlags (generic)

  // ── Folder records ──
  // Per BSA convention, the offset stored in each folder record points to the
  // folder's data block and has totalFileNameLength added to it.
  let folderDataPos = folderDataOffset;
  for (const folder of folders) {
    buf.writeBigUInt64LE(folder.folderHash, pos); // nameHash (uint64)
    pos += 8;
    buf.writeUInt32LE(folder.files.length, pos); // fileCount
    pos += 4;

    // offset: absolute position of this folder's data block + totalFileNameLength
    const adjustedOffset = folderDataPos + totalFileNameLength;

    if (version === 105) {
      // v105: 4-byte padding + 8-byte uint64 offset
      buf.writeUInt32LE(0, pos); // unk (padding for v105)
      pos += 4;
      buf.writeBigUInt64LE(BigInt(adjustedOffset), pos); // offset (uint64)
      pos += 8;
    } else {
      // v104: 4-byte uint32 offset (no padding)
      buf.writeUInt32LE(adjustedOffset, pos); // offset (uint32)
      pos += 4;
    }

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
      buf.writeBigUInt64LE(f.nameHash, pos); // nameHash
      pos += 8;
      buf.writeUInt32LE(f.sizeField, pos); // size (with compression toggle when set)
      pos += 4;
      buf.writeUInt32LE(fileDataOffsets[fileIdx], pos); // absolute offset
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

  log.info(
    `BSA: wrote v${version} archive with ${fileCount} files in ${folderCount} folders, ${totalSize} bytes`,
  );
  return buf;
};
