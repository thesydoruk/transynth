import type { EspStringRow } from '../../../formats/esp';
import type { StringsType } from '../../../formats/types/StringsType';
import type { CsvRow } from '../../../types';
import type { LstringEspIndex } from './types';

/**
 * Map an ESP string row to the strings table type that resolves its lstring id.
 *
 * Fallout/Skyrim convention: INFO/NAM1 → DLSTRINGS, INFO/RNAM → ILSTRINGS,
 * everything else → STRINGS.
 */
export const resolveStringsTypeForEspRow = (row: EspStringRow): StringsType => {
  const sub = row.path.includes('\\') ? (row.path.split('\\').pop() ?? row.path) : row.path;
  if (row.signature === 'INFO') {
    if (sub === 'NAM1') return 'DLSTRINGS';
    if (sub === 'RNAM') return 'ILSTRINGS';
  }
  return 'STRINGS';
};

/** Build lstring id → ESP row lookup split by strings file type. */
export const buildLstringEspIndex = (espRows: EspStringRow[]): LstringEspIndex => {
  const index: LstringEspIndex = new Map();

  for (const row of espRows) {
    if (!row.isLstringId) continue;
    const id = Number.parseInt(row.text, 10);
    if (!Number.isFinite(id) || id <= 0) continue;

    const type = resolveStringsTypeForEspRow(row);
    if (!index.has(type)) index.set(type, new Map());
    const byId = index.get(type)!;
    const bucket = byId.get(id);
    if (bucket) bucket.push(row);
    else byId.set(id, [row]);
  }

  return index;
};

/** Convert one ESP row plus resolved text into a CSV/import row. */
export const espRowToCsvRow = (espRow: EspStringRow, text: string): CsvRow => ({
  FormID: espRow.formId,
  Signature: espRow.signature,
  EDID: espRow.edid || undefined,
  Path: `${espRow.signature}\\${espRow.path}`,
  PathSimplified: `${espRow.signature}\\${espRow.path}`,
  LStringID: Number.parseInt(espRow.text, 10),
  Source: text,
  DialogTopicFormID: espRow.dialogTopicFormId,
  PreviousInfoFormID: espRow.previousInfoFormId,
  SpeakerFormID: espRow.speakerFormId,
});
