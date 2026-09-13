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
 *   File entries (36 bytes each):
 *     nameHash   : uint32   CRC-32 of the lowercased stem (filename without extension)
 *     ext        : char[4]  extension bytes, zero-padded
 *     dirHash    : uint32   CRC-32 of the lowercased directory path
 *     flags      : uint32   (0 for uncompressed GNRL)
 *     offset     : uint64   absolute offset to raw file data
 *     packedSize : uint32   compressed size (0 = not compressed)
 *     realSize   : uint32   uncompressed data length
 *     align      : uint32   (0)
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
    entries.writeUInt32LE(0, base + 12);
    entries.writeBigUInt64LE(BigInt(offsets[i]!), base + 16);
    entries.writeUInt32LE(prepared[i]!.packedSize, base + 24);
    entries.writeUInt32LE(prepared[i]!.realSize, base + 28);
    entries.writeUInt32LE(0, base + 32);
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

/**
 * Build a BA2 (GNRL, version 1) archive.
 *
 * Pass `destPath` to stream onto disk (needed for archives larger than ~4 GiB).
 * Compression still follows each file's `compressed` flag, except STRINGS and `Sound\`.
 */
export function writeBa2(files: readonly Ba2InputFile[]): Buffer;
export function writeBa2(files: readonly Ba2InputFile[], destPath: string): number;
export function writeBa2(files: readonly Ba2InputFile[], destPath?: string): Buffer | number {
  const streamFromDisk = Boolean(destPath);
  const prepared = files.map((file) => prepareEntry(file, streamFromDisk));
  const dataStart = BA2_HEADER_SIZE + prepared.length * BA2_ENTRY_SIZE;
  const offsets: number[] = [];
  let currentOffset = dataStart;
  for (const entry of prepared) {
    offsets.push(currentOffset);
    currentOffset += entry.storedSize;
  }
  const nameTableOffset = currentOffset;
  const { header, entries } = buildHeaderAndEntries(prepared, offsets, nameTableOffset);
  const names = prepared.map((entry) => entry.name);

  if (destPath) {
    const fd = fs.openSync(destPath, 'w');
    try {
      fs.writeSync(fd, header);
      fs.writeSync(fd, entries);
      for (const entry of prepared) {
        if (entry.payload) fs.writeSync(fd, entry.payload);
        else copyFileToFd(fd, entry.absPath!);
      }
      writeNameTable((buf) => {
        fs.writeSync(fd, buf);
      }, names);
    } finally {
      fs.closeSync(fd);
    }
    const byteSize = fs.statSync(destPath).size;
    log.info(`BA2: wrote archive with ${prepared.length} files, ${byteSize} bytes → ${destPath}`);
    return byteSize;
  }

  const chunks: Buffer[] = [header, entries];
  for (const entry of prepared) chunks.push(entry.payload!);
  writeNameTable((buf) => {
    chunks.push(buf);
  }, names);
  const result = Buffer.concat(chunks);
  log.info(`BA2: wrote archive with ${prepared.length} files, ${result.length} bytes`);
  return result;
}
