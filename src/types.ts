/**
 * Identifier of a game supported by the app, e.g. `fo4` or `disco`.
 *
 * This is deliberately an open `string`, not a closed union: which games exist
 * is decided by the plugins registered in `src/games`, not by this file.
 * Adding a title must never require editing shared types. Validate an id that
 * came from the outside (a DB column, a query string, an upload form) with
 * `isGameId` / `resolveGameId` from `src/games` before trusting it.
 */
export type GameId = string;

/**
 * A single row from a Transynth CSV export or import file.
 * Represents one translatable record extracted from an ESP/ESM form.
 *
 * @field FormID - Hex form identifier, e.g. `00012345`.
 * @field Signature - Four-character record type, e.g. `DIAL`, `INFO`, `BOOK`.
 * @field Path - Full subrecord path within the form.
 * @field Source - Original (source-language) text value.
 * @field LStringID - Localised-string numeric ID (present for localized plugins).
 * @field EDID - Editor ID of the owning record.
 * @field PathSimplified - Path with array indices stripped, used for anchor matching.
 * @field Hash - SHA-1 of the normalised source text, used for deduplication.
 */
export type CsvRow = {
  FormID: string;
  Signature: string;
  Path: string;
  Source: string;
  LStringID?: number;
  Hints?: string;
  EDID?: string;
  PathSimplified?: string;
  Hash?: string;
  DialogTopicFormID?: string;
  PreviousInfoFormID?: string;
  SpeakerFormID?: string;
};

/**
 * Composite key used to anchor a `CsvRow` during CSV diff-and-reimport.
 * Fields are matched in priority order: hash (strongest) → edid+sig → sig+path.
 *
 * @field signature - Record type (e.g. `INFO`).
 * @field pathSimplified - Array-index-free subrecord path.
 * @field edid - Editor ID of the owning record.
 * @field hash - SHA-1 of the normalised source text.
 */
export type AnchorKey = {
  signature: string;
  pathSimplified?: string;
  edid?: string | null;
  hash?: string | null;
};
