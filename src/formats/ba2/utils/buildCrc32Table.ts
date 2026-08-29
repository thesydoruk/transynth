/**
 * Build CRC-32 lookup table using the IEEE 802.3 polynomial.
 *
 * The reflected polynomial 0xEDB88320 is the bit-reversed form of 0x04C11DB7,
 * which is the standard CRC-32 generator used by Ethernet, ZIP, PNG, and the
 * Bethesda BA2 archive format for entry name/dir hashing.
 *
 * Algorithm: for each byte value 0..255, shift out 8 bits, XOR-ing with the
 * polynomial whenever the lowest bit is set. The result is a 256-entry table
 * that allows single-lookup-per-byte CRC computation.
 *
 * @returns A precomputed 256-entry Uint32Array CRC table.
 */
export const buildCrc32Table = (): Uint32Array => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    // Shift out 8 bits; XOR with reflected polynomial when LSB is set
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }

  return table;
};
