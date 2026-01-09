#!/usr/bin/env tsx
/**
 * eet2csv — convert .eet (ESP-ESM Translator) files to CSV.
 *
 * Usage:
 *   tsx src/cli/eet2csv.ts --file input.eet [--out output.csv]
 *
 * Output columns: FormID, Signature, EDID, Path, Source, Target, Status
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseEetFile } from '../bethesda/eetReader.js';
import { csvRow } from '../utils/csv.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string', short: 'f' },
    out:  { type: 'string', short: 'o' },
  },
  strict: false,
});

if (!values.file) {
  console.error('Usage: tsx src/cli/eet2csv.ts --file <path.eet> [--out <path.csv>]');
  process.exit(1);
}

const filePath = path.resolve(values.file);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const buf = fs.readFileSync(filePath);
const { header, records } = parseEetFile(buf);

const HEADER = ['FormID', 'Signature', 'EDID', 'Path', 'Source', 'Target', 'Status'];
const lines = [csvRow(HEADER)];

for (const r of records) {
  const status = r.status === 0x63 ? 'confirmed' : r.status === 0xFF ? 'untranslated' : String(r.status);
  lines.push(csvRow([r.formId, r.signature, r.edid, r.field, r.source, r.target, status]));
}

const csv = lines.join('\n') + '\n';

if (values.out) {
  fs.writeFileSync(path.resolve(values.out), csv, 'utf8');
  console.log(`Wrote ${records.length} records to ${values.out}`);
} else {
  process.stdout.write(csv);
}
