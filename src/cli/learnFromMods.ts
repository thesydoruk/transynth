#!/usr/bin/env tsx
/**
 * learnFromMods.ts
 *
 * Build TM from pairs of translated mods.
 * Reads strings natively from ESP + BA2 — no external tools required.
 *
 * Usage:
 *   tsx src/cli/learnFromMods.ts \
 *     --pair Mod.esp:Mod_uk.esp \
 *     --pair OtherMod.esp:OtherMod_uk.esp \
 *     [--srcLang en] [--tgtLang uk]
 */
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDb, upsertMod, addTranslation, closeDb } from '../db.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { sha1Hex } from '../utils/hash.js';
import { alignPairs } from '../align/alignPairs.js';
import { log } from '../logger.js';
import { ingestCsvRows } from '../utils/ingest.js';
import type { CsvRow, GameType } from '../types.js';
import { EspReader } from '../bethesda/espReader.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import { parseStringsBuffer, stringsTypeFromPath } from '../bethesda/stringsFile.js';

const argv = await yargs(hideBin(process.argv))
  .option('pair',    { type: 'array',  demandOption: true, desc: '<orig>:<translated>' })
  .option('srcLang', { type: 'string', default: 'en' })
  .option('tgtLang', { type: 'string', default: 'uk' })
  .option('game',    { type: 'string', default: 'fo4', desc: 'Game type: fo4, fo76, sse, or sle', choices: ['fo4', 'fo76', 'fo3', 'fnv', 'sse', 'sle'] as const })
  .parse();

const discoverBa2 = (modPath: string): string | null => {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath));
  for (const c of [`${stem} - Main.ba2`, `${stem}.ba2`]) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const extractRows = (modPath: string, lang: string): CsvRow[] => {
  const game = argv.game as GameType;
  const esp = new EspReader(modPath, game);
  const espRows = esp.extractStrings();

  if (!esp.info.isLocalized) {
    return espRows
      .filter(r => r.text)
      .map(r => ({
        FormID:    r.formId,
        Signature: r.signature,
        EDID:      r.edid || undefined,
        Path:      `${r.signature}\\${r.path}`,
        Source:    r.text,
      }));
  }

  // Localized mod: resolve LString IDs from BA2
  const stringsMap = new Map<number, string>();
  const ba2Path = discoverBa2(modPath);
  if (ba2Path) {
    const ba2 = new Ba2Reader(ba2Path);
    for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
      for (const entry of ba2.listByExt(ext)) {
        const base = (entry.name.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
        if (!base.includes(`_${lang}.`)) continue;
        const map = parseStringsBuffer(ba2.extractEntry(entry), stringsTypeFromPath(entry.name));
        for (const [id, text] of map) stringsMap.set(id, text);
      }
    }
  }

  const rows: CsvRow[] = [];
  for (const r of espRows) {
    if (!r.isLstringId) continue;
    const text = stringsMap.get(parseInt(r.text, 10));
    if (!text) continue;
    rows.push({
      FormID:    r.formId,
      Signature: r.signature,
      EDID:      r.edid || undefined,
      Path:      `${r.signature}\\${r.path}`,
      Source:    text,
    });
  }
  return rows;
}

const db = openDb();

for (const spec of (argv.pair as string[])) {
  const [orig, tran] = spec.split(':');

  let left: CsvRow[], right: CsvRow[];
  try {
    left  = extractRows(orig, argv.srcLang as string);
    right = extractRows(tran, argv.tgtLang as string);
  } catch (err: any) {
    log.error(`Failed to read pair ${path.basename(orig)}:${path.basename(tran)}: ${err?.message ?? err}`);
    continue;
  }

  if (left.length === 0 || right.length === 0) {
    log.warn(`Skipping ${path.basename(orig)}: one side has no rows.`);
    continue;
  }

  left.forEach(r  => { (r as Record<string, unknown>).Hash = sha1Hex(normalizeForHash(r.Source)); });
  right.forEach(r => { (r as Record<string, unknown>).Hash = sha1Hex(normalizeForHash(r.Source)); });

  const hashOrig = sha1Hex(fs.readFileSync(orig));
  const hashTran = sha1Hex(fs.readFileSync(tran));
  const modIdOrig = await upsertMod(db, path.basename(orig), path.resolve(orig), hashOrig);
  const modIdTran = await upsertMod(db, path.basename(tran), path.resolve(tran), hashTran);

  const leftIds = await ingestCsvRows(db, modIdOrig, left,  argv.srcLang as string, 'native');
  void ingestCsvRows(db, modIdTran, right, argv.tgtLang as string, 'native');

  const pairs = await alignPairs(left, right, { fuzzyMin: 85, fuzzyStrong: 90, useEmbeddings: false });

  for (const p of pairs) {
    const srcStrId = leftIds[p.leftIndex].stringId;
    const tgtText  = right[p.rightIndex].Source;
    await addTranslation(db, srcStrId, argv.tgtLang as string, tgtText,
      p.method === 'rapidfuzz' ? 'fuzzy' : 'tm', p.score, p.method);
  }
  log.info(`Learned from pair ${path.basename(orig)}:${path.basename(tran)} → ${pairs.length} aligned rows`);
}
