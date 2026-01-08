#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ensureDir, copyFileSafe } from '../utils/file.js';
import { translateBatch } from '../llm/translate.js';
import { maskPlaceholders, applyGlossaryMask, unmask } from '../utils/placeholders.js';
import { CONFIG, getTranslateModel, validateConfig } from '../config.js';
import { log } from '../logger.js';
import { EspReader } from '../bethesda/espReader.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import {
  parseStringsBuffer,
  writeStringsBuffer,
  stringsTypeFromPath,
} from '../bethesda/stringsFile.js';
import { patchEsp, type EspPatch } from '../bethesda/espWriter.js';

const argv = await yargs(hideBin(process.argv))
  .option('mod',      { type: 'string', demandOption: true })
  .option('ba2',      { type: 'string', desc: 'BA2 archive (auto-detected if omitted)' })
  .option('outDir',   { type: 'string', demandOption: true })
  .option('srcLang',  { type: 'string', default: 'en' })
  .option('tgtLang',  { type: 'string', default: 'uk' })
  .option('style',    { type: 'string' })
  .option('glossary', { type: 'string' })
  .parse();

validateConfig();
const modPath = path.resolve(argv.mod as string);
if (!fs.existsSync(modPath)) { log.error(`Mod not found: ${modPath}`); process.exit(1); }

ensureDir(argv.outDir as string);
const copyPath = path.join(argv.outDir as string, path.basename(modPath));
copyFileSafe(modPath, copyPath);

// --- Parse ESP ---
const esp = new EspReader(modPath);
const espRows = esp.extractStrings();
log.info(`ESP: ${espRows.length} rows (localized=${esp.info.isLocalized})`);

// --- Locate BA2 next to the ESP ---
function findBa2(p: string): string | null {
  const dir = path.dirname(p);
  const stem = path.basename(p, path.extname(p));
  for (const c of [`${stem} - Main.ba2`, `${stem}.ba2`]) {
    const full = path.join(dir, c);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Per-type source strings info (preserves file-type so output stays consistent)
type FileInfo = {
  map: Map<number, string>;
  type: ReturnType<typeof stringsTypeFromPath>;
  nameStem: string;
};
const srcFiles: FileInfo[] = [];
const srcStrings = new Map<number, string>();

if (esp.info.isLocalized) {
  const ba2Path = argv.ba2 ? path.resolve(argv.ba2 as string) : findBa2(modPath);
  if (!ba2Path) {
    log.error('Localized plugin requires a BA2 archive (--ba2 or auto-detected next to the ESP).');
    process.exit(1);
  }
  const ba2 = new Ba2Reader(ba2Path);
  const srcLang = (argv.srcLang as string).toLowerCase();

  for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
    for (const entry of ba2.listByExt(ext)) {
      const base = (entry.name.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
      if (!base.includes(`_${srcLang}.`)) continue;
      const type = stringsTypeFromPath(entry.name);
      const map = parseStringsBuffer(ba2.extractEntry(entry), type);
      const nameStem = base.replace(new RegExp(`_${srcLang}\\.(strings|dlstrings|ilstrings)$`), '');
      srcFiles.push({ map, type, nameStem });
      for (const [id, text] of map) srcStrings.set(id, text);
    }
  }
  log.info(`Source strings: ${srcStrings.size} from ${srcFiles.length} file(s)`);
}

// --- Build translate list ---
interface Item { text: string; lstringId?: number; formId: string; subrecord: string }
const items: Item[] = [];

for (const r of espRows) {
  if (r.isLstringId) {
    const id = parseInt(r.text, 10);
    const text = srcStrings.get(id);
    if (!text) continue;
    items.push({ text, lstringId: id, formId: r.formId, subrecord: r.path });
  } else {
    if (!r.text) continue;
    items.push({ text: r.text, formId: r.formId, subrecord: r.path });
  }
}

if (!items.length) { log.warn('No translatable strings.'); process.exit(0); }
log.info(`Translating ${items.length} strings…`);

const styleMd = argv.style && fs.existsSync(argv.style as string)
  ? fs.readFileSync(argv.style as string, 'utf8') : undefined;
const glossary = argv.glossary && fs.existsSync(argv.glossary as string)
  ? fs.readFileSync(argv.glossary as string, 'utf8').split(/\r?\n/).filter(Boolean) : [];

const results: string[] = new Array(items.length);
type Pending = { text: string; ph: Map<string,string>; gl: Map<string,string>; idx: number };
const pending: Pending[] = [];

async function flush() {
  if (!pending.length) return;
  let texts: string[];
  try {
    texts = await translateBatch(pending.map(p => p.text), getTranslateModel(), styleMd, glossary);
  } catch (err: any) {
    log.error(`Translation failed: ${err?.message || err}`);
    throw err;
  }
  for (let k = 0; k < texts.length; k++) {
    const { ph, gl, idx } = pending[k];
    results[idx] = unmask(unmask(texts[k], gl), ph);
  }
  pending.length = 0;
}

for (let i = 0; i < items.length; i++) {
  const src = items[i].text;
  if (!/\p{L}/u.test(src)) { results[i] = src; continue; }
  const { masked: m1, mapping: ph } = maskPlaceholders(src);
  const { masked: m2, mapping: gl } = applyGlossaryMask(m1, glossary);
  pending.push({ text: m2, ph, gl, idx: i });
  if (pending.length >= CONFIG.batchSize) await flush();
}
await flush();

// --- Apply translations ---
if (esp.info.isLocalized) {
  // Build translated lstring map
  const translatedMap = new Map<number, string>();
  for (let i = 0; i < items.length; i++) {
    const { lstringId } = items[i];
    if (lstringId !== undefined && results[i]) translatedMap.set(lstringId, results[i]);
  }

  // Write per-type translated Strings files alongside the ESP copy
  const tgtLang = (argv.tgtLang as string).toLowerCase();
  const stringsDir = path.join(argv.outDir as string, 'Strings');
  ensureDir(stringsDir);

  for (const { map: srcMap, type, nameStem } of srcFiles) {
    const tgtMap = new Map<number, string>();
    for (const [id, srcText] of srcMap) {
      tgtMap.set(id, translatedMap.get(id) ?? srcText);
    }
    const buf = writeStringsBuffer(tgtMap, type);
    const outFile = path.join(stringsDir, `${nameStem}_${tgtLang}.${type}`);
    fs.writeFileSync(outFile, buf);
    log.info(`Wrote ${path.basename(outFile)} (${tgtMap.size} entries)`);
  }
  log.info(`Done. ESP copy: ${copyPath}  Strings: ${stringsDir}/`);
} else {
  // Patch ESP binary directly
  const patches: EspPatch[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!results[i]) continue;
    patches.push({ formId: items[i].formId, subrecord: items[i].subrecord, newText: results[i] });
  }
  const patched = patchEsp(fs.readFileSync(modPath), patches);
  fs.writeFileSync(copyPath, patched);
  log.info(`Done. Patched ESP: ${copyPath} (${patches.length} changes)`);
}


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

for (const [flag, val] of [['--xedit', argv.xedit], ['--exporter', argv.exporter], ['--applier', argv.applier], ['--mod', argv.mod]] as [string, string][]) {
  if (!fs.existsSync(val)) {
    log.error(`File not found for ${flag}: ${val}`);
    process.exit(1);
  }
}

ensureDir(argv.outDir as string);
const copyPath = path.join(argv.outDir as string, path.basename(modPath));
copyFileSafe(modPath, copyPath);

const work = path.join(argv.outDir as string, '_work');
ensureDir(work);
const csvSrc = path.join(work, 'strings.src.csv');
const csvTgt = path.join(work, `strings.${argv.tgtLang}.csv`);

try {
  await runXEditExport(argv.xedit as string, argv.exporter as string, modPath, csvSrc);
} catch (err: any) {
  log.error(`xEdit export failed: ${err?.message || err}`);
  process.exit(1);
}

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
  if (batch.length >= CONFIG.batchSize) await flush();
}
await flush();
fs.writeFileSync(csvTgt, out.join('\n'), 'utf8');

try {
  await runXEditApply(argv.xedit as string, argv.applier as string, copyPath, csvTgt);
} catch (err: any) {
  log.error(`xEdit apply failed: ${err?.message || err}`);
  process.exit(1);
}
log.info(`Done. Localized replacement: ${copyPath}`);

async function flush() {
  if (batch.length === 0) return;
  let items: string[];
  try {
    items = await translateBatch(batch, getTranslateModel(), styleMd, glossary);
  } catch (err: any) {
    log.error(`Translation failed: ${err?.message || err}`);
    throw err;
  }
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
