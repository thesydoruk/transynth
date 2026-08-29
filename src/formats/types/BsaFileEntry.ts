/**
 * A single file entry within a BSA archive.
 *
 * The interface is intentionally compatible with the archive extraction logic
 * so that callers can use the same pipeline for both BA2 and BSA formats.
 */
export interface BsaFileEntry {
  /** Full lowercased path within the archive, e.g. `"strings\\modname_english.strings"`. */
  name: string;
  /** Absolute byte offset of the file data within the archive. */
  dataOffset: number;
  /** On-disk byte count of the file data (compressed size if `isCompressed`). */
  dataSize: number;
  /** True when the file data is zlib-compressed and must be decompressed before use. */
  isCompressed: boolean;
}
