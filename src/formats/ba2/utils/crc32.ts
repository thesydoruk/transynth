/**
 * The CRC-32 Archive2 writes into a BA2 entry's `nameHash` and `dirHash`.
 *
 * Same reflected IEEE 802.3 polynomial as zlib's crc32, but the register starts
 * at 0 and is not inverted at the end, so the values differ from a standard
 * CRC-32: the game's own archives give `00112d18_1` → 0x2aa3a289, where a
 * standard CRC-32 gives 0xc929caff. The game looks files up by these hashes;
 * an archive hashed the standard way is one it cannot read. The table is
 * pre-built once at module load time.
 */
import { buildCrc32Table } from './buildCrc32Table';

/** Pre-built 256-entry lookup table, initialized once at module load. */
const CRC32_TABLE = buildCrc32Table();

/**
 * Archive2's CRC-32 of a buffer (init 0, no final xor).
 *
 * @param buf - Buffer whose contents should be hashed (a lowercased path part).
 * @returns Unsigned 32-bit value as the game's archives store it.
 */
export const crc32 = (buf: Buffer): number => {
  let crc = 0;

  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff]! ^ (crc >>> 8);
  }

  return crc >>> 0;
};
