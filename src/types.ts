export type CsvRow = {
  FormID: string;
  Signature: string;
  Path: string;
  Source: string;
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
