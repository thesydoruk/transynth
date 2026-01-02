#!/usr/bin/env tsx
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { translateBatch } from '../llm/translate.js';
import { maskPlaceholders, applyGlossaryMask, unmask } from '../utils/placeholders.js';
import { openDb, bestTranslation, addTranslation } from '../db.js';
import { CONFIG, getTranslateModel, validateConfig } from '../config.js';
import { readCsv, csvRow } from '../utils/csv.js';

const argv = await yargs(hideBin(process.argv))
  .option('in', { type: 'string', demandOption: true })
  .option('out', { type: 'string', demandOption: true })
  .option('srcLang', { type: 'string', default: 'en' })
  .option('tgtLang', { type: 'string', default: 'uk' })
  .option('style', { type: 'string' })
  .option('glossary', { type: 'string' })
  .parse();

validateConfig();
const styleMd = argv.style ? fs.readFileSync(argv.style, 'utf8') : undefined;
const glossary = argv.glossary && fs.existsSync(argv.glossary) ? fs.readFileSync(argv.glossary, 'utf8').split(/\r?\n/).filter(Boolean) : [];

const rows = readCsv(argv.in as string);
const header = fs.readFileSync(argv.in, 'utf8').split(/\r?\n/)[0]!;

const db = openDb();
const outLines = [header.replace(/Source/i, `${argv.tgtLang}`)];

const batch: string[] = [];
const metas: any[] = [];
const outTexts: (string|null)[] = new Array(rows.length).fill(null);

for (let i=0;i<rows.length;i++) {
  const src = rows[i].Source;
  if (!/\p{L}/u.test(src)) { outTexts[i] = src; continue; }

  const cached = null; // optionally query DB for an exact prior translation for this specific string row
  if (cached) { outTexts[i] = cached; continue; }

  const { masked: m1, mapping: ph } = maskPlaceholders(src);
  const { masked: m2, mapping: gl } = applyGlossaryMask(m1, glossary);
  batch.push(m2);
  metas.push({ i, ph, gl });
  if (batch.length >= 30) await flush();
}
await flush();

for (let i=0;i<rows.length;i++) {
  const r = rows[i];
  const t = outTexts[i] ?? r.Source;
  const cols = [r.FormID, r.Signature];
  if (r.EDID !== undefined) cols.push(r.EDID);
  cols.push(r.Path, t, r.Hints || '');
  outLines.push(csvRow(cols));
}
fs.writeFileSync(argv.out, outLines.join('\n'), 'utf8');
console.log('Wrote', argv.out);

async function flush() {
  if (batch.length === 0) return;
  const translated = await translateBatch(batch, getTranslateModel(), styleMd, glossary);
  for (let k=0;k<translated.length;k++) {
    const { i, ph, gl } = metas[k];
    const restored = unmask(unmask(translated[k], gl), ph).trim();
    outTexts[i] = restored;

    // optionally store into DB translations table as 'auto'
    // addTranslation(db, srcStringId, argv.tgtLang, restored, 'auto', 0.9, 'model', CONFIG.translateModel);
  }
  batch.length = 0; metas.length = 0;
}
