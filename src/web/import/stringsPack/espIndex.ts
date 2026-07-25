import type { EspStringRow } from '../../../formats/esp';
import { resolveStringsTableTypeForRow } from '../../../formats/strings/recorddefs';
import type { StringsType } from '../../../formats/types/StringsType';
import type { GameType } from '../../../types';
import type { CsvRow } from '../../../types';
import type { LstringEspIndex } from './types';

/**
 * Map an ESP string row to the strings table type that resolves its lstring id.
 *
 * Uses per-game xTranslator `_recorddefs.txt` rules (see `formats/strings/recorddefs`).
 */
export const resolveStringsTypeForEspRow = (
  row: EspStringRow,
  game: GameType = 'fo4',
): StringsType => resolveStringsTableTypeForRow(game, row.signature, row.path);

/** Build lstring id → ESP row lookup split by strings file type. */
export const buildLstringEspIndex = (
  espRows: EspStringRow[],
  game: GameType = 'fo4',
): LstringEspIndex => {
  const index: LstringEspIndex = new Map();

  for (const row of espRows) {
    if (!row.isLstringId) continue;
    const id = Number.parseInt(row.text, 10);
    if (!Number.isFinite(id) || id <= 0) continue;

    const type = resolveStringsTypeForEspRow(row, game);
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
