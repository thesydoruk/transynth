/**
 * Build CRC-32 lookup table (IEEE 802.3 polynomial).
 *
 * @returns A precomputed 256-entry CRC table.
 */
export const buildCrc32Table = (): Uint32Array => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }

  return table;
};
