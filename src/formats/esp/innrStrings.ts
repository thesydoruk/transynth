/**
 * INNR (Instance Naming Rule) string extraction for Fallout 4 / 76 / Starfield.
 *
 * INNR records contain repeated WNAM subrecords — one per naming-rule condition.
 * Each WNAM holds the text fragment appended when its keyword conditions match
 * (or "*" to insert the base item FULL name, which is not stored as WNAM text).
 * The WNAM lstring is laid out the same in all three games.
 */
import { decodeGameText } from '../strings';
import { forEachSubrecord, type ComponentBrackets } from './recordData';

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
  const text = decodeGameText(data, dataStart, dataEnd).replace(/\0/g, '');
  return isTranslatableWnamText(text) ? text : null;
};

/**
 * Extract indexed WNAM rows from a decompressed INNR record payload.
 *
 * Paths use `WNAM[n]` so multiple fragments on one FormID stay unique in the DB.
 *
 * @param components - Base-form component brackets of the title (Starfield):
 *   a component may carry a WNAM of its own that is not a name fragment.
 */
export const extractInnrWnamRows = (
  recordData: Buffer,
  isLocalized: boolean,
  components: ComponentBrackets = null,
): InnrWnamRow[] => {
  const rows: InnrWnamRow[] = [];
  forEachSubrecord(
    recordData,
    (subSig, dataStart, dataEnd) => {
      if (subSig !== 'WNAM') return;
      const text = readInnrWnamText(recordData, dataStart, dataEnd, isLocalized);
      if (text !== null) rows.push({ path: `WNAM[${rows.length}]`, text });
    },
    components,
  );
  return rows;
};
