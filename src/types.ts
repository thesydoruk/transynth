/**
 * Supported game identifiers.
 * - `fo4`  — Fallout 4 (uses BA2 archives, BTDX magic)
 * - `fo76` — Fallout 76 (uses BA2 archives, same engine as FO4)
 * - `fo3`  — Fallout 3 (uses BSA v104 archives, non-localized ESPs)
 * - `fnv`  — Fallout: New Vegas (uses BSA v104 archives, non-localized ESPs)
 * - `ob`   — The Elder Scrolls IV: Oblivion (uses BSA v103 archives)
 * - `mw`   — The Elder Scrolls III: Morrowind (uses BSA archives)
 * - `sse`  — Skyrim Special Edition (uses BSA archives, BSA\0 magic, version 105)
 * - `sle`  — Skyrim Legendary Edition / Original (uses BSA archives, version 104)
 */
export type GameType = 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle';

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
