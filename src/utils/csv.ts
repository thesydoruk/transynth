// Centralized CSV parser — RFC 4180 compliant.
// Handles quoted fields and escaped double quotes ("").

import fs from 'fs';
import type { CsvRow } from '../types';

/**
 * Parse a single CSV line into an array of field values (RFC 4180).
 * Supports: quoted fields, commas inside quotes, escaped quotes ("").
 */
export const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let pos = 0;
  const len = line.length;

  while (pos <= len) {
    if (pos >= len) break;

    if (line[pos] === '"') {
      // Quoted field
      let val = '';
      pos++; // skip opening quote
      while (pos < len) {
        if (line[pos] === '"' && pos + 1 < len && line[pos + 1] === '"') {
          val += '"';
          pos += 2;
        } else if (line[pos] === '"') {
          pos++; // skip closing quote
          break;
        } else {
          val += line[pos++];
        }
      }
      fields.push(val);
    } else {
      // Unquoted field
      const commaIdx = line.indexOf(',', pos);
      if (commaIdx === -1) {
        fields.push(line.slice(pos));
        return fields;
      }
      fields.push(line.slice(pos, commaIdx));
      pos = commaIdx;
    }

    if (pos < len && line[pos] === ',') {
      pos++;
      if (pos >= len) fields.push(''); // trailing comma → empty field
    } else {
      break;
    }
  }

  return fields;
};

/** Encode fields into a single CSV line (RFC 4180 — all fields quoted). */
export const csvRow = (fields: string[]): string => {
  return fields.map((f) => `"${(f ?? '').replace(/"/g, '""')}"`).join(',');
};

/**
 * Read a CSV file into CsvRow[].
 * Column mapping is derived from the header row (order-independent).
 */
export const readCsv = (filePath: string): CsvRow[] => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headerLine = lines.shift()!;
  const cols = parseCsvLine(headerLine);
  const idx = (name: string) => cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());

  return lines.map((line) => {
    const f = parseCsvLine(line);
    const row: CsvRow = {
      FormID: f[idx('FormID')] ?? '',
      Signature: f[idx('Signature')] ?? '',
      Path: f[idx('Path')] ?? '',
      Source: f[idx('Source')] ?? '',
      Hints: f[idx('Hints')] ?? '',
    };
    const edidIdx = idx('EDID');
    if (edidIdx >= 0) row.EDID = f[edidIdx] ?? '';
    return row;
  });
};
