/**
 * BA2 GNRL format constants used by reader/writer modules.
 */
export const BA2_MAGIC = 'BTDX';
export const BA2_TYPE_GNRL = 'GNRL';
export const BA2_VERSION = 1;
export const BA2_HEADER_SIZE = 24;
/** Versions a GNRL archive can carry: Fallout 4 / 76 (1, 7, 8) and Starfield (2, 3). */
export const BA2_GNRL_VERSIONS: readonly number[] = [1, 2, 3, 7, 8];
/**
 * Header size by version: the 24 common bytes (magic, version, type, file count,
 * name table offset), plus a uint64 (always 1) in v2 and v3, plus a uint32
 * compression format (0 = zlib, 3 = LZ4) in v3 only.
 * Source: the Rust `ba2` crate (Ryan-rsm-McKenzie/bsa-rs), src/fo4/archive.rs,
 * `HEADER_SIZE_V1/V2/V3` and the header reader/writer.
 */
export const ba2HeaderSize = (version: number): number =>
  version === 2 ? 32 : version === 3 ? 36 : BA2_HEADER_SIZE;
export const BA2_ENTRY_SIZE = 36;
/** What Archive2 writes into every GNRL entry's flags field. */
export const BA2_ENTRY_FLAGS = 0x100100;
/** What Archive2 writes into every GNRL entry's align field. */
export const BA2_ENTRY_ALIGN = 0xbaadf00d;
