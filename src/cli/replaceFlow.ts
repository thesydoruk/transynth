#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runXEditExport } from '../xedit/runExport.js';
import { runXEditApply } from '../xedit/runApply.js';
import { ensureDir, copyFileSafe } from '../utils/file.js';
import { translateBatch } from '../llm/translate.js';
import { maskPlaceholders, applyGlossaryMask, unmask } from '../utils/placeholders.js';
import { CONFIG, getTranslateModel, validateConfig } from '../config.js';
import { readCsv, csvRow } from '../utils/csv.js';

const argv = await yargs(hideBin(process.argv))
  .option('xedit', { type: 'string', demandOption: true })
  .option('exporter', { type: 'string', demandOption: true })
  .option('applier', { type: 'string', demandOption: true })
  .option('mod', { type: 'string', demandOption: true })
  .option('outDir', { type: 'string', demandOption: true })
  .option('srcLang', { type: 'string', default: 'en' })
  .option('tgtLang', { type: 'string', default: 'uk' })
  .option('style', { type: 'string' })
  .option('glossary', { type: 'string' })
  .parse();

validateConfig();
const modPath = argv.mod as string;
ensureDir(argv.outDir as string);
const copyPath = path.join(argv.outDir as string, path.basename(modPath));
copyFileSafe(modPath, copyPath);

const work = path.join(argv.outDir as string, '_work');
ensureDir(work);
const csvSrc = path.join(work, 'strings.src.csv');
const csvTgt = path.join(work, `strings.${argv.tgtLang}.csv`);

await runXEditExport(argv.xedit as string, argv.exporter as string, modPath, csvSrc);

const styleMd = argv.style && fs.existsSync(argv.style) ? fs.readFileSync(argv.style, 'utf8') : undefined;
const glossary = argv.glossary && fs.existsSync(argv.glossary) ? fs.readFileSync(argv.glossary, 'utf8').split(/\r?\n/).filter(Boolean) : [];

const rows = readCsv(csvSrc);
const header = fs.readFileSync(csvSrc, 'utf8').split(/\r?\n/)[0]!;
const tgtHeader = header.replace(/Source/i, argv.tgtLang as string);

const batch: string[] = [];
const metas: any[] = [];
const out: string[] = [tgtHeader];

for (const r of rows) {
  const src = r.Source;
  if (!/\p{L}/u.test(src)) {
    const cols = [r.FormID, r.Signature];
    if (r.EDID !== undefined) cols.push(r.EDID);
    cols.push(r.Path, src, r.Hints || '');
    out.push(csvRow(cols));
    continue;
  }
  const { masked: m1, mapping: ph } = maskPlaceholders(src);
  const { masked: m2, mapping: gl } = applyGlossaryMask(m1, glossary);
  batch.push(m2);
  metas.push({ row: r, ph, gl });
  if (batch.length >= 30) await flush();
}
await flush();
fs.writeFileSync(csvTgt, out.join('\n'), 'utf8');

await runXEditApply(argv.xedit as string, argv.applier as string, copyPath, csvTgt);
console.log('Done. Localized replacement:', copyPath);

async function flush() {
  if (batch.length === 0) return;
  const items = await translateBatch(batch, getTranslateModel(), styleMd, glossary);
  for (let i=0;i<items.length;i++) {
    const { row, ph, gl } = metas[i];
    const restored = unmask(unmask(items[i], gl), ph);
    const cols = [row.FormID, row.Signature];
    if (row.EDID !== undefined) cols.push(row.EDID);
    cols.push(row.Path, restored, row.Hints || '');
    out.push(csvRow(cols));
  }
  batch.length = 0; metas.length = 0;
}
