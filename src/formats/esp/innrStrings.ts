/**
 * INNR (Instance Naming Rule) string extraction for Fallout 4 / 76.
 *
 * INNR records contain repeated WNAM subrecords — one per naming-rule condition.
 * Each WNAM holds the text fragment appended when its keyword conditions match
 * (or "*" to insert the base item FULL name, which is not stored as WNAM text).
 */
import { SUBRECORD_HEADER_SIZE } from './recordData';

export type InnrWnamRow = { path: string; text: string };

const isTranslatableWnamText = (text: string): boolean => text.length > 0 && text !== '*';

/** Read one INNR WNAM payload as an lstring id or inline zstring. */
export const readInnrWnamText = (
  data: Buffer,
  dataStart: number,
  dataEnd: number,
  isLocalized: boolean,
): string | null => {
  const subSize = dataEnd - dataStart;
  if (isLocalized) {
    if (subSize !== 4) return null;
    const lstrId = data.readUInt32LE(dataStart);
    return lstrId === 0 ? null : String(lstrId);
  }
  if (subSize <= 0) return null;
  const text = data.toString('utf8', dataStart, dataEnd).replace(/\0/g, '');
  return isTranslatableWnamText(text) ? text : null;
};

/**
 * Extract indexed WNAM rows from a decompressed INNR record payload.
 *
 * Paths use `WNAM[n]` so multiple fragments on one FormID stay unique in the DB.
 */
export const extractInnrWnamRows = (recordData: Buffer, isLocalized: boolean): InnrWnamRow[] => {
  const rows: InnrWnamRow[] = [];
  let wnamIndex = 0;
  let pos = 0;

  while (pos + SUBRECORD_HEADER_SIZE <= recordData.length) {
    const subSig = recordData.toString('ascii', pos, pos + 4);
    const subSize = recordData.readUInt16LE(pos + 4);
    const dataStart = pos + SUBRECORD_HEADER_SIZE;
    const dataEnd = dataStart + subSize;

    if (subSig === 'WNAM') {
      const text = readInnrWnamText(recordData, dataStart, dataEnd, isLocalized);
      if (text !== null) {
        rows.push({ path: `WNAM[${wnamIndex}]`, text });
        wnamIndex++;
      }
    }

    pos = dataEnd;
  }

  return rows;
};
