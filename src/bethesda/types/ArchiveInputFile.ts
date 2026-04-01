/**
 * Input file descriptor used by archive writers (BA2, BSA).
 *
 * Both BA2 and BSA writers consume the same shape: an archive-relative path
 * and the raw file bytes to store.
 */
export interface ArchiveInputFile {
  /** Archive-relative path, e.g. `"Strings\\mod_uk.STRINGS"`. */
  name: string;
  /** Raw file bytes to store in the archive. */
  data: Buffer;
}
