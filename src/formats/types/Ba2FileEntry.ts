/**
 * A single file entry in a BA2 archive.
 *
 * This mirrors the on-disk metadata for the GNRL format and is kept small on
 * purpose so that higher-level code can decide how to interpret the payload.
 */
export interface Ba2FileEntry {
  /** Archive-relative path, e.g. `"Strings\\mod_en.STRINGS"`. */
  name: string;
  /** Four-character extension from the entry header (already trimmed). */
  ext: string;
  /** Raw byte offset of the file data within the archive. */
  offset: number;
  /**
   * Packed byte length on disk.
   *
   * When `0`, the entry is stored uncompressed and `unpackedSize` is used
   * instead. When `> 0`, the entry payload is zlib-compressed.
   */
  packedSize: number;
  /** Expected uncompressed payload size in bytes. */
  unpackedSize: number;
}
