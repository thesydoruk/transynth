/**
 * CRC-32 (IEEE 802.3) checksum for BA2 archive entry hashing.
 *
 * Used by the BA2 writer to compute `nameHash` and `dirHash` fields in
 * file entry records. The table is pre-built once at module load time.
 */
import { buildCrc32Table } from './buildCrc32Table';

/** Pre-built 256-entry lookup table, initialized once at module load. */
const CRC32_TABLE = buildCrc32Table();

/**
 * Compute CRC-32 (IEEE 802.3) checksum for a buffer.
 *
 * @param buf - Buffer whose contents should be hashed.
 * @returns Unsigned 32-bit CRC value.
 */
export const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff;

  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};
