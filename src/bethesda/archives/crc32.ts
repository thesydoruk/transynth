import { buildCrc32Table } from './buildCrc32Table';

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
