/**
 * Input file descriptor used by BA2 writer.
 */
export interface Ba2InputFile {
  /** Archive-relative path, e.g. "Strings\\mod_uk.STRINGS". */
  name: string;
  /** Raw file bytes to store in the archive (written uncompressed). */
  data: Buffer;
}
