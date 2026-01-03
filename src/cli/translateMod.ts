#!/usr/bin/env tsx
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { translateBatch } from '../llm/translate.js';
import { maskPlaceholders, applyGlossaryMask, unmask } from '../utils/placeholders.js';
import { openDb, bestTranslation, addTranslation, findStringId } from '../db.js';
import { CONFIG, getTranslateModel, validateConfig } from '../config.js';
import { readCsv, csvRow } from '../utils/csv.js';
import { log } from '../logger.js';

const argv = await yargs(hideBin(process.argv))
  .option('in', { type: 'string', demandOption: true })
  .option('out', { type: 'string', demandOption: true })
  .option('srcLang', { type: 'string', default: 'en' })
  .option('tgtLang', { type: 'string', default: 'uk' })
  .option('style', { type: 'string' })
  .option('glossary', { type: 'string' })
  .parse();

validateConfig();

if (!fs.existsSync(argv.in as string)) {
  log.error(`Input file not found: ${argv.in}`);
  process.exit(1);
}

const styleMd = argv.style ? fs.readFileSync(argv.style as string, 'utf8') : undefined;
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
  if (batch.length >= CONFIG.batchSize) await flush();
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
fs.writeFileSync(argv.out as string, outLines.join('\n'), 'utf8');
log.info(`Wrote ${argv.out}`);

async function flush() {
  if (batch.length === 0) return;
  let translated: string[];
  try {
    translated = await translateBatch(batch, getTranslateModel(), styleMd, glossary);
  } catch (err: any) {
    log.error(`Translation failed: ${err?.message || err}`);
    throw err;
  }
  for (let k=0;k<translated.length;k++) {
    const { i, ph, gl } = metas[k];
    const restored = unmask(unmask(translated[k], gl), ph).trim();
    outTexts[i] = restored;

    const r = rows[i];
    const srcStrId = findStringId(db, r.FormID, r.Path, argv.srcLang as string);
    if (srcStrId !== undefined) {
      addTranslation(db, srcStrId, argv.tgtLang as string, restored, 'auto', null, 'model', getTranslateModel());
    }
  }
  batch.length = 0; metas.length = 0;
}
