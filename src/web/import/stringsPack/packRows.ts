import path from 'node:path';
import type { EspStringRow } from '../../../formats/esp';
import type { CsvRow } from '../../../types';
import { sha1Hex, sha1HexFile } from '../../../utils/hash';
import { espRowToCsvRow } from './espIndex';
import type { LstringEspIndex, StringsPackFile } from './types';

/** Build a stable content hash from all strings files in one stem group. */
export const computeStringsPackHash = async (files: StringsPackFile[]): Promise<string> => {
  const parts: string[] = [];
  for (const file of files) {
    const rel = path.basename(file.filePath);
    const hash = await sha1HexFile(file.filePath);
    parts.push(`${rel}:${hash}`);
  }
  return sha1Hex(parts.join('\n'));
};

/** Derive a mod name from the plugin stem and content hash. */
export const buildStringsPackModName = (stem: string, contentHash: string): string => {
  return `${stem}__${contentHash.slice(0, 8)}`;
};

/**
 * Build import rows by matching strings file entries to ESP lstring references.
 *
 * Each matched ESP row becomes one identifiable record (FormID, EDID, subrecord).
 */
export const buildStringsPackRows = (
  file: StringsPackFile,
  entries: Map<number, string>,
  lstringIndex: LstringEspIndex,
): { rows: CsvRow[]; mapped: number; unmapped: number } => {
  const rows: CsvRow[] = [];
  let mapped = 0;
  let unmapped = 0;
  const byId = lstringIndex.get(file.type) ?? new Map<number, EspStringRow[]>();

  for (const [id, text] of entries) {
    if (!text) continue;
    const espRows = byId.get(id);
    if (!espRows || espRows.length === 0) {
      unmapped++;
      continue;
    }
    for (const espRow of espRows) {
      rows.push(espRowToCsvRow(espRow, text));
      mapped++;
    }
  }

  return { rows, mapped, unmapped };
};
