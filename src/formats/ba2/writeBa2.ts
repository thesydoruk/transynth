/**
 * BA2 (GNRL, version 1) archive writer.
 *
 * Binary layout:
 *
 *   Header (24 bytes):
 *     magic           : char[4]  = 'BTDX'
 *     version         : uint32   = 1
 *     type            : char[4]  = 'GNRL'
 *     fileCount       : uint32
 *     nameTableOffset : uint64   (absolute offset to the name table)
 *
 *   File entries (36 bytes each), in name order as Archive2 writes them:
 *     nameHash   : uint32   Archive2's CRC-32 of the lowercased stem (see utils/crc32)
 *     ext        : char[4]  extension bytes, zero-padded
 *     dirHash    : uint32   Archive2's CRC-32 of the lowercased directory path
 *     flags      : uint32   0x100100, as in every archive the game ships
 *     offset     : uint64   absolute offset to raw file data
 *     packedSize : uint32   compressed size (0 = not compressed)
 *     realSize   : uint32   uncompressed data length
 *     align      : uint32   0xBAADF00D, as in every archive the game ships
 *
 *   The game finds a file by its hashes, not by the name table, and refused to
 *   start on an archive with standard CRC-32 hashes and zeroed flags.
 *
 *   Raw file data (concatenated in entry order)
 *
 *   Name table:
 *     For each file: uint16 nameLength + UTF-8 name bytes (no null terminator).
 */
import fs from 'node:fs';
import { deflateSync, constants as zlibConstants } from 'zlib';
import { log } from '../../logger';
import { isSoundArchivePath, isStringsTablePath } from './creationKitArchiveRules';
import {
  BA2_ENTRY_ALIGN,
  BA2_ENTRY_FLAGS,
  BA2_ENTRY_SIZE,
  BA2_HEADER_SIZE,
  BA2_MAGIC,
  BA2_TYPE_GNRL,
  BA2_VERSION,
} from './utils/ba2Constants';
import { crc32 } from './utils/crc32';
import { getBa2PathParts } from './utils/getBa2PathParts';

export type Ba2InputFile = {
  name: string;
  data?: Buffer;
  absPath?: string;
  compressed?: boolean;
};

const packBa2Payload = (
  raw: Buffer,
  compress: boolean,
): { payload: Buffer; packedSize: number; realSize: number } => {
  if (!compress) {
    return { payload: raw, packedSize: 0, realSize: raw.length };
  }

  const compressed = deflateSync(raw, { level: zlibConstants.Z_BEST_COMPRESSION });
  if (compressed.length >= raw.length) {
    return { payload: raw, packedSize: 0, realSize: raw.length };
  }

  return { payload: compressed, packedSize: compressed.length, realSize: raw.length };
};

const shouldCompressFile = (file: Ba2InputFile): boolean =>
  file.compressed === true && !isStringsTablePath(file.name) && !isSoundArchivePath(file.name);

const rawBytes = (file: Ba2InputFile): Buffer => {
  if (file.data) return file.data;
  if (file.absPath) return fs.readFileSync(file.absPath);
  throw new Error(`BA2 entry "${file.name}" has no data source`);
};

type PreparedEntry = {
  name: string;
  packedSize: number;
  realSize: number;
  storedSize: number;
  payload?: Buffer;
  absPath?: string;
};

const prepareEntry = (file: Ba2InputFile, streamFromDisk: boolean): PreparedEntry => {
  const name = file.name.replace(/\//g, '\\');
  if (shouldCompressFile(file)) {
    const raw = rawBytes(file);
    const packed = packBa2Payload(raw, true);
    return {
      name,
      packedSize: packed.packedSize,
      realSize: raw.length,
      storedSize: packed.payload.length,
      payload: packed.payload,
    };
  }
  if (streamFromDisk && file.absPath && !file.data) {
    const realSize = fs.statSync(file.absPath).size;
    return { name, packedSize: 0, realSize, storedSize: realSize, absPath: file.absPath };
  }
  const raw = rawBytes(file);
  return { name, packedSize: 0, realSize: raw.length, storedSize: raw.length, payload: raw };
};

const buildHeaderAndEntries = (
  prepared: readonly PreparedEntry[],
  offsets: readonly number[],
  nameTableOffset: number,
): { header: Buffer; entries: Buffer } => {
  const fileCount = prepared.length;
  const header = Buffer.alloc(BA2_HEADER_SIZE);
  header.write(BA2_MAGIC, 0, 4, 'ascii');
  header.writeUInt32LE(BA2_VERSION, 4);
  header.write(BA2_TYPE_GNRL, 8, 4, 'ascii');
  header.writeUInt32LE(fileCount, 12);
  header.writeBigUInt64LE(BigInt(nameTableOffset), 16);

  const entries = Buffer.alloc(fileCount * BA2_ENTRY_SIZE);
  for (let i = 0; i < fileCount; i++) {
    const base = i * BA2_ENTRY_SIZE;
    const { dir, stem, ext } = getBa2PathParts(prepared[i]!.name);
    entries.writeUInt32LE(crc32(Buffer.from(stem)), base);
    const extBuf = Buffer.alloc(4);
    Buffer.from(ext.substring(0, 4)).copy(extBuf);
    extBuf.copy(entries, base + 4);
    entries.writeUInt32LE(crc32(Buffer.from(dir)), base + 8);
    entries.writeUInt32LE(BA2_ENTRY_FLAGS, base + 12);
    entries.writeBigUInt64LE(BigInt(offsets[i]!), base + 16);
    entries.writeUInt32LE(prepared[i]!.packedSize, base + 24);
    entries.writeUInt32LE(prepared[i]!.realSize, base + 28);
    entries.writeUInt32LE(BA2_ENTRY_ALIGN, base + 32);
  }
  return { header, entries };
};

const writeNameTable = (write: (buf: Buffer) => void, names: readonly string[]): void => {
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(nameBytes.length);
    write(lenBuf);
    write(nameBytes);
  }
};

const copyFileToFd = (fd: number, absPath: string): void => {
  const src = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n = 0;
    while ((n = fs.readSync(src, buf, 0, buf.length, null)) > 0) {
      fs.writeSync(fd, buf, 0, n);
    }
  } finally {
    fs.closeSync(src);
  }
};

/** Header, entry table and name table for `prepared`, laid out in entry order. */
const layoutArchive = (
  prepared: readonly PreparedEntry[],
): { header: Buffer; entries: Buffer; nameTable: Buffer } => {
  const offsets: number[] = [];
  let currentOffset = BA2_HEADER_SIZE + prepared.length * BA2_ENTRY_SIZE;
  for (const entry of prepared) {
    offsets.push(currentOffset);
    currentOffset += entry.storedSize;
  }
  const { header, entries } = buildHeaderAndEntries(prepared, offsets, currentOffset);
  const nameChunks: Buffer[] = [];
  writeNameTable(
    (buf) => {
      nameChunks.push(buf);
    },
    prepared.map((entry) => entry.name),
  );
  return { header, entries, nameTable: Buffer.concat(nameChunks) };
};

/**
 * Build a BA2 (GNRL, version 1) archive.
 *
 * Pass `destPath` to stream onto disk (needed for archives larger than ~4 GiB).
 * Compression still follows each file's `compressed` flag, except STRINGS and `Sound\`.
 * Both forms block the event loop for the whole write; a worker building a
 * large archive should use `writeBa2File`.
 */
export function writeBa2(files: readonly Ba2InputFile[]): Buffer;
export function writeBa2(files: readonly Ba2InputFile[], destPath: string): number;
export function writeBa2(files: readonly Ba2InputFile[], destPath?: string): Buffer | number {
  const streamFromDisk = Boolean(destPath);
  const prepared = files.map((file) => prepareEntry(file, streamFromDisk));
  const { header, entries, nameTable } = layoutArchive(prepared);

  if (destPath) {
    const fd = fs.openSync(destPath, 'w');
    try {
      fs.writeSync(fd, header);
      fs.writeSync(fd, entries);
      for (const entry of prepared) {
        if (entry.payload) fs.writeSync(fd, entry.payload);
        else copyFileToFd(fd, entry.absPath!);
      }
      fs.writeSync(fd, nameTable);
    } finally {
      fs.closeSync(fd);
    }
    const byteSize = fs.statSync(destPath).size;
    log.info(`BA2: wrote archive with ${prepared.length} files, ${byteSize} bytes → ${destPath}`);
    return byteSize;
  }

  const chunks: Buffer[] = [header, entries];
  for (const entry of prepared) chunks.push(entry.payload!);
  chunks.push(nameTable);
  const result = Buffer.concat(chunks);
  log.info(`BA2: wrote archive with ${prepared.length} files, ${result.length} bytes`);
  return result;
}

/** How many on-disk entries are stat'ed concurrently while laying out the archive. */
const STAT_BATCH = 256;

const prepareEntriesAsync = async (files: readonly Ba2InputFile[]): Promise<PreparedEntry[]> => {
  const prepared: PreparedEntry[] = [];
  for (let start = 0; start < files.length; start += STAT_BATCH) {
    const batch = await Promise.all(
      files.slice(start, start + STAT_BATCH).map(async (file) => {
        if (!file.absPath || file.data || shouldCompressFile(file)) {
          return prepareEntry(file, false);
        }
        const realSize = (await fs.promises.stat(file.absPath)).size;
        const name = file.name.replace(/\//g, '\\');
        return { name, packedSize: 0, realSize, storedSize: realSize, absPath: file.absPath };
      }),
    );
    prepared.push(...batch);
  }
  return prepared;
};

const copyFileToHandle = async (out: fs.promises.FileHandle, absPath: string): Promise<void> => {
  const src = await fs.promises.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await src.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      await out.write(buf, 0, bytesRead);
    }
  } finally {
    await src.close();
  }
};

/**
 * Stream a BA2 (GNRL, version 1) archive onto disk without holding the event loop.
 *
 * Byte-for-byte the same archive as `writeBa2(files, destPath)`, but every stat,
 * read and write yields, so a worker's job-lock heartbeat and other jobs keep
 * running while an archive of hundreds of thousands of files is built.
 */
export const writeBa2File = async (
  files: readonly Ba2InputFile[],
  destPath: string,
): Promise<number> => {
  const prepared = await prepareEntriesAsync(files);
  const { header, entries, nameTable } = layoutArchive(prepared);
  const out = await fs.promises.open(destPath, 'w');
  try {
    await out.write(header);
    await out.write(entries);
    for (const entry of prepared) {
      if (entry.payload) await out.write(entry.payload);
      else await copyFileToHandle(out, entry.absPath!);
    }
    await out.write(nameTable);
  } finally {
    await out.close();
  }
  const byteSize = (await fs.promises.stat(destPath)).size;
  log.info(`BA2: wrote archive with ${prepared.length} files, ${byteSize} bytes → ${destPath}`);
  return byteSize;
};
