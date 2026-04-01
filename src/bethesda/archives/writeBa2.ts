import { log } from '../../logger';
import type { ArchiveInputFile } from '../types';
import {
  BA2_ENTRY_SIZE,
  BA2_HEADER_SIZE,
  BA2_MAGIC,
  BA2_TYPE_GNRL,
  BA2_VERSION,
} from './ba2Constants';
import { crc32 } from './crc32';
import { getBa2PathParts } from './getBa2PathParts';

/**
 * Build a BA2 (GNRL, version 1) archive buffer from a list of files.
 *
 * @param files - Array of archive entries with relative name and raw data.
 * @returns Newly allocated buffer containing the complete BA2 archive.
 */
export const writeBa2 = (files: ArchiveInputFile[]): Buffer => {
  const fileCount = files.length;
  const dataStart = BA2_HEADER_SIZE + fileCount * BA2_ENTRY_SIZE;

  const offsets: number[] = [];
  let currentOffset = dataStart;
  for (const f of files) {
    offsets.push(currentOffset);
    currentOffset += f.data.length;
  }

  const nameTableOffset = currentOffset;

  const header = Buffer.alloc(BA2_HEADER_SIZE);
  header.write(BA2_MAGIC, 0, 4, 'ascii');
  header.writeUInt32LE(BA2_VERSION, 4);
  header.write(BA2_TYPE_GNRL, 8, 4, 'ascii');
  header.writeUInt32LE(fileCount, 12);
  header.writeBigUInt64LE(BigInt(nameTableOffset), 16);

  const entries = Buffer.alloc(fileCount * BA2_ENTRY_SIZE);
  for (let i = 0; i < fileCount; i++) {
    const base = i * BA2_ENTRY_SIZE;
    const { dir, stem, ext } = getBa2PathParts(files[i].name);

    entries.writeUInt32LE(crc32(Buffer.from(stem)), base);
    const extBuf = Buffer.alloc(4);
    Buffer.from(ext.substring(0, 4)).copy(extBuf);
    extBuf.copy(entries, base + 4);
    entries.writeUInt32LE(crc32(Buffer.from(dir)), base + 8);
    entries.writeUInt32LE(0, base + 12);
    entries.writeBigUInt64LE(BigInt(offsets[i]), base + 16);
    entries.writeUInt32LE(0, base + 24);
    entries.writeUInt32LE(files[i].data.length, base + 28);
    entries.writeUInt32LE(0, base + 32);
  }

  const nameParts: Buffer[] = [];
  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(nameBytes.length);
    nameParts.push(lenBuf, nameBytes);
  }

  const result = Buffer.concat([header, entries, ...files.map((f) => f.data), ...nameParts]);
  log.info(`BA2: wrote archive with ${fileCount} files, ${result.length} bytes`);
  return result;
};
