/**
 * REDengine 3 `.bundle` archives, read-only.
 *
 * Measured on the Remastered (2026) `content0/bundles` — 79 archives, 365,866
 * files, every offset in range:
 *
 * ```
 * "POTATO70"  u32 bundleSize  u32 0  u32 tocSize  (12 more header bytes)
 * at 0x20, tocSize bytes of 304-byte entries:
 *     char[256] path (NUL-padded, `\` separators)   u8[16] hash
 *     u64 offset   u32 size   u32 storedSize   u32 crc   u32 compression
 *     u64 0
 * ```
 *
 * Compression is 0 (stored) or 1 (zlib) in every Remastered archive; the older
 * game also used Snappy, Doboz and LZ4, which an archive from it would need.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const MAGIC = 'POTATO70';
const HEADER_SIZE = 0x20;
const ENTRY_SIZE = 304;

export type BundleEntry = {
  /** Archive-internal path, lowercased, forward slashes. */
  path: string;
  offset: number;
  size: number;
  storedSize: number;
  compression: number;
};

export type BundleIndex = { file: string; entries: BundleEntry[] };

export const readBundleIndex = (file: string): BundleIndex => {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(HEADER_SIZE);
    fs.readSync(fd, head, 0, HEADER_SIZE, 0);
    if (head.toString('latin1', 0, 8) !== MAGIC) throw new Error(`Not a REDengine bundle: ${file}`);
    const tocSize = head.readUInt32LE(16);
    const toc = Buffer.alloc(tocSize);
    fs.readSync(fd, toc, 0, tocSize, HEADER_SIZE);
    const entries: BundleEntry[] = [];
    for (let p = 0; p + ENTRY_SIZE <= toc.length; p += ENTRY_SIZE) {
      const nameEnd = toc.indexOf(0, p);
      const name = toc.toString('latin1', p, Math.min(nameEnd < 0 ? p + 256 : nameEnd, p + 256));
      if (!name) continue;
      entries.push({
        path: name.replace(/\\/g, '/').toLowerCase(),
        offset: Number(toc.readBigUInt64LE(p + 272)),
        size: toc.readUInt32LE(p + 280),
        storedSize: toc.readUInt32LE(p + 284),
        compression: toc.readUInt32LE(p + 292),
      });
    }
    return { file, entries };
  } finally {
    fs.closeSync(fd);
  }
};

/** One file's bytes out of its archive. */
export const readBundleEntry = (fd: number, entry: BundleEntry): Buffer => {
  const stored = Buffer.alloc(entry.storedSize);
  fs.readSync(fd, stored, 0, entry.storedSize, entry.offset);
  if (entry.compression === 0) return stored;
  if (entry.compression === 1) return zlib.inflateSync(stored);
  throw new Error(`Unsupported bundle compression ${entry.compression} for ${entry.path}`);
};
