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
import { readCsv } from '../utils/csv.js';
import type { CsvRow } from '../types.js';
import { log } from '../logger.js';
import { ingestCsvRows } from '../utils/ingest.js';

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

  try {
    await runXEditExport(argv.xedit as string, argv.exporter as string, orig, enCsv);
    await runXEditExport(argv.xedit as string, argv.exporter as string, tran, ukCsv);
  } catch (err: any) {
    log.error(`xEdit export failed for pair ${path.basename(orig)}:${path.basename(tran)}: ${err?.message || err}`);
    continue;
  }

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

  log.info(`Learned from pair ${path.basename(orig)} : ${path.basename(tran)} → ${pairs.length} aligned rows`);
}
