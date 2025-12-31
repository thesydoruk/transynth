#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDb, upsertMod, upsertRecord, insertString, addTranslation } from '../db.js';
import { runXEditExport } from '../xedit/runExport.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { sha1Hex } from '../utils/hash.js';
import { alignPairs } from '../align/alignPairs.js';
import type { CsvRow } from '../types.js';

const argv = await yargs(hideBin(process.argv))
  .option('xedit', { type: 'string', demandOption: true })
  .option('exporter', { type: 'string', demandOption: true })
  .option('pair', { type: 'array', demandOption: true, desc: '<orig>:<translated>' })
  .option('srcLang', { type: 'string', default: 'en' })
  .option('tgtLang', { type: 'string', default: 'uk' })
  .parse();

const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'learn_'));

const db = openDb();

for (const spec of (argv.pair as string[])) {
  const [orig, tran] = spec.split(':');
  const enCsv = path.join(tmpDir, path.basename(orig) + '.src.csv');
  const ukCsv = path.join(tmpDir, path.basename(tran) + '.tgt.csv');

  await runXEditExport(argv.xedit as string, argv.exporter as string, orig, enCsv);
  await runXEditExport(argv.xedit as string, argv.exporter as string, tran, ukCsv);

  const left = readCsv(enCsv);
  const right = readCsv(ukCsv);

  // add normalized hash anchors
  left.forEach(r => { (r as any).Hash = sha1Hex(normalizeForHash(r.Source)); });
  right.forEach(r => { (r as any).Hash = sha1Hex(normalizeForHash(r.Source)); });

  // store mods
  const hashOrig = sha1Hex(fs.readFileSync(orig));
  const hashTran = sha1Hex(fs.readFileSync(tran));
  const modIdOrig = upsertMod(db, path.basename(orig), path.resolve(orig), hashOrig);
  const modIdTran = upsertMod(db, path.basename(tran), path.resolve(tran), hashTran);

  // ingest rows into DB
  const leftIds = ingestCsvRows(db, modIdOrig, left, argv.srcLang as string, 'export');
  const rightIds = ingestCsvRows(db, modIdTran, right, argv.tgtLang as string, 'export');

  // align
  const pairs = await alignPairs(left, right, { fuzzyMin: 85, fuzzyStrong: 90, useEmbeddings: false });

  // write TM candidates into translations as 'tm' (exact/fuzzy)
  for (const p of pairs) {
    const srcStrId = leftIds[p.leftIndex].stringId;
    const tgtText = right[p.rightIndex].Source;
    addTranslation(db, srcStrId, argv.tgtLang as string, tgtText, p.method === 'rapidfuzz' ? 'fuzzy' : 'tm', p.score, p.method);
  }

  console.log(`Learned from pair ${path.basename(orig)} : ${path.basename(tran)} → ${pairs.length} aligned rows`);
}

function readCsv(p: string): CsvRow[] {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines.shift()!;
  const cols = header.split(',').map(s => s.replace(/^"|"$/g,''));
  const idx = (name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());
  const out: CsvRow[] = [];
  for (const line of lines) {
    const fields = parseCsv(line);
    out.push({
      FormID: fields[idx('FormID')],
      Signature: fields[idx('Signature')],
      Path: fields[idx('Path')],
      Source: fields[idx('Source')],
      Hints: fields[idx('Hints')] || '',
    });
  }
  return out;
}

function parseCsv(line: string) {
  const parts: string[] = [];
  let cur = '', inQ=false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { parts.push(cur); cur=''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function ingestCsvRows(db: any, modId: number, rows: CsvRow[], lang: string, sourceKind: string) {
  return rows.map(r => {
    const pathSimplified = r.Path.replace(/\[\d+\]/g, '');
    const hashNorm = sha1Hex(normalizeForHash(r.Source));
    const recId = upsertRecord(db, modId, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
    const strId = insertString(db, recId, lang, r.Source, normalizeForHash(r.Source), sourceKind);
    return { recordId: recId, stringId: strId };
  });
}
