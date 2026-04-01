/**
 * Input file descriptor used by BSA writer.
 */
export interface BsaInputFile {
  /** Archive-relative path, e.g. "Strings\\ModName_uk.STRINGS". */
  name: string;
  /** Raw file content. */
  data: Buffer;
}
