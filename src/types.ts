/**
 * Supported game identifiers.
 * - `fo4`  — Fallout 4 (uses BA2 archives, BTDX magic)
 * - `fo76` — Fallout 76 (uses BA2 archives, same engine as FO4)
 * - `sse`  — Skyrim Special Edition (uses BSA archives, BSA\0 magic, version 105)
 * - `sle`  — Skyrim Legendary Edition / Original (uses BSA archives, version 104)
 */
export type GameType = 'fo4' | 'fo76' | 'sse' | 'sle';

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
};

export type AnchorKey = {
  signature: string;
  pathSimplified?: string;
  edid?: string|null;
  hash?: string|null;
};

export type AlignPair = {
  leftIndex: number;     // index in left array
  rightIndex: number;    // index in right array
  method: 'edid'|'hash'|'path'|'rapidfuzz'|'embedding'|'arbiter';
  score: number;
};
