// Centralized CSV parser — RFC 4180 compliant.
// Handles quoted fields and escaped double quotes ("").

/**
 * Split CSV text into records (RFC 4180), each an array of field values.
 *
 * Records are not lines: a quoted field may span lines — book pages and long
 * dialogue do — and its line breaks are kept as written. Blank lines between
 * records are skipped.
 */
export function* iterCsvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = '';
  let rowStarted = false;
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      rowStarted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      rowStarted = true;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (rowStarted) {
        row.push(field);
        yield row;
      }
      row = [];
      field = '';
      rowStarted = false;
    } else {
      field += c;
      rowStarted = true;
    }
  }
  if (rowStarted) {
    row.push(field);
    yield row;
  }
}

/** Encode fields into a single CSV line (RFC 4180 — all fields quoted). */
export const csvRow = (fields: string[]): string => {
  return fields.map((f) => `"${(f ?? '').replace(/"/g, '""')}"`).join(',');
};
