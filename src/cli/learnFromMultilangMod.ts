#!/usr/bin/env tsx
/**
 * learnFromMultilangMod.ts
 *
 * Purpose
 * -------
 * Harvest parallel text from a single multi-lingual Fallout 4 plugin and build a TM.
 * The script:
 *  - auto-detects all locales found in the mod's BA2 (or loose Strings/ folder);
 *  - supports custom locales via --extraLocales (checked against loose files) or
 *    --locales (full override, no auto-detection);
 *  - computes per-locale coverage + content hash, filters out fake/fallback/empty locales;
 *  - detects "cloned locales" (identical content across locales) and collapses them into a
 *    single canonical locale using a stable preference order;
 *  - ingests accepted (non-aliased) locales into SQLite and aligns each src→tgt pair to TM.
 *
 * Duplicate/Cloned locales
 * ------------------------
 * Some mods ship multiple STRINGS files with identical content (all locales = English copy).
 * We hash normalized content per-locale and collapse duplicates. Canonical selection uses a
 * priority order (default: en, fr, it, de, es, pl, ru, ja, then extras).
 *
 * Usage examples
 * --------------
 * 1) Auto-detect from BA2, also try uk:
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --mod "D:\mods\BigQuest.esp" \
 *      --extraLocales uk
 *
 * 2) Full locale override (no auto-detection):
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --mod "D:\mods\BigQuest.esp" \
 *      --locales en,ru,uk
 *
 * 3) Prefer 'ru' as canonical over 'en' for identical content:
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --mod "D:\mods\BigQuest.esp" \
 *      --canonicalPrefer ru,en,fr,it,de,es,pl,ja
 *
 * 4) Enable embeddings for ambiguous fuzzy matches:
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --mod "D:\mods\BigQuest.esp" \
 *      --useEmbeddings
 */

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { openDb, upsertMod, addTranslation, closeDb } from '../db.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { sha1Hex } from '../utils/hash.js';
import type { CsvRow } from '../types.js';
import { alignPairs } from '../align/alignPairs.js';
import { getEmbedModel } from '../config.js';
import { readCsv } from '../utils/csv.js';
import { exportForLocale } from '../xedit/runExport.js';
import { log } from '../logger.js';
import { ingestCsvRows } from '../utils/ingest.js';

// ---------- Constants ----------

// Official Fallout 4 locales (Steam/GOG)
const OFFICIAL_LOCALES = ['en', 'fr', 'it', 'de', 'es', 'pl', 'ru', 'ja'] as const;
type OfficialLocale = typeof OFFICIAL_LOCALES[number];

// Minimal share of "real" text required to treat a locale as present
const MIN_COVERAGE = 0.02; // 2%

// Default canonical priority for clones: keep first that appears in this list
const DEFAULT_CANONICAL_PREFERENCE = ['en','fr','it','de','es','pl','ru','ja'];

// ---------- CLI ----------

const argv = await yargs(hideBin(process.argv))
  .option('xedit',     { type: 'string', demandOption: true,  desc: 'Path to FO4Edit executable (xEdit)' })
  .option('exporter',  { type: 'string', demandOption: true,  desc: 'Path to ExportTextForTranslation.pas' })
  .option('mod',       { type: 'string', demandOption: true,  desc: 'Path to plugin (esm/esp/esl)' })
  .option('locales',   { type: 'string',                      desc: 'Comma-separated locales to use (override auto-detection)' })
  .option('extraLocales', { type: 'string',                   desc: 'Comma-separated extra locales to add to auto-detected set (e.g., uk, zh)' })
  .option('canonicalPrefer', { type: 'string',                desc: 'Comma-separated priority order to keep among clones; defaults to en,fr,it,de,es,pl,ru,ja,(extras as given)' })
  .option('pairs',     { type: 'array',                       desc: 'Optional forced pairs (e.g., en:uk,ru:uk). Default: all combinations src!=tgt among accepted (non-aliased) locales' })
  .option('tmpDir',    { type: 'string', default: '',         desc: 'Working directory for CSV exports (default: mkdtemp)' })
  .option('fuzzyMin',  { type: 'number', default: 85,         desc: 'Fuzzy minimum score (0..100) to consider for embedding rerank' })
  .option('fuzzyStrong',{ type: 'number', default: 90,        desc: 'Fuzzy score (0..100) to accept directly without embeddings' })
  .option('useEmbeddings', { type: 'boolean', default: false, desc: 'Enable embeddings rerank for ambiguous fuzzy matches' })
  .parse();

// ---------- Helpers ----------

/** Compute coverage and normalized content hash for a locale export. */
function summarizeLocale(rows: CsvRow[]) {
  const total = rows.length || 1;
  let real = 0;
  const normalized: string[] = [];
  for (const r of rows) {
    const s = r.Source ?? '';
    const isId = /^\$[0-9]+$/.test(s);
    const nonEmpty = s.trim().length > 0;
    if (nonEmpty && !isId) real++;
    normalized.push(normalizeForHash(s));
  }
  const coverage = real / total;
  const hash = sha1Hex(normalized.join('\n'));
  return { coverage, hash };
}

/** Decide if a locale is worth keeping on its own (not empty and not duplicate content-wise). */
function acceptLocale(summary: {coverage:number;hash:string}, knownHashes: Set<string>) {
  if (summary.coverage < MIN_COVERAGE) return false;
  if (knownHashes.has(summary.hash)) return false;
  return true;
}

/** All ordered pairs src→tgt for locales, excluding src==tgt. */
function allPairs(arr: string[]) {
  const res: string[] = [];
  for (let i=0;i<arr.length;i++) for (let j=0;j<arr.length;j++) if (i!==j) res.push(`${arr[i]}:${arr[j]}`);
  return res;
}

/** Build canonical preference list (defaults to OFFICIAL order, then extras as given). */
function buildPreference(extras: string[]|null, override: string|undefined) {
  if (override && override.trim()) {
    return override.split(',').map(s => s.trim()).filter(Boolean);
  }
  const base = [...DEFAULT_CANONICAL_PREFERENCE];
  if (extras) for (const e of extras) if (!base.includes(e)) base.push(e);
  return base;
}

// ---------- Main ----------

(async () => {
  const xedit = argv.xedit as string;
  const exporter = argv.exporter as string;
  const modPath = argv.mod as string;

  const workingDir = argv.tmpDir ? path.resolve(argv.tmpDir) : fs.mkdtempSync(path.join(process.cwd(), 'ml_'));
  if (!fs.existsSync(workingDir)) fs.mkdirSync(workingDir, { recursive: true });

  const db = openDb();
  const modName = path.basename(modPath);
  const modHash = sha1Hex(fs.readFileSync(modPath));
  const modId = await upsertMod(db, modName, path.resolve(modPath), modHash);

  // Resolve candidate locales
  let localesToTry: string[];
  let extras: string[]|null = null;

  if (argv.locales) {
    localesToTry = (argv.locales as string).split(',').map(s => s.trim()).filter(Boolean);
  } else {
    localesToTry = [...OFFICIAL_LOCALES];
    if (argv.extraLocales) {
      extras = (argv.extraLocales as string).split(',').map(s => s.trim()).filter(Boolean);
      for (const e of extras) if (!localesToTry.includes(e)) localesToTry.push(e);
    }
  }

  const canonicalOrder = buildPreference(extras, argv.canonicalPrefer as string | undefined);

  // Pass 1: export each locale, summarize
  type Probe = { locale: string; rows: CsvRow[]; hash: string; coverage: number; csv: string };
  const probes: Probe[] = [];

  for (const loc of localesToTry) {
    const outCsv = path.join(workingDir, `${modName}.${loc}.csv`);
    try {
      const ok = await exportForLocale(xedit, exporter, modPath, loc, outCsv);
      if (!ok) {
        log.info(`[detect] ${loc}: no rows exported (unsupported or empty)`);
        continue;
      }
      const rows = readCsv(outCsv);
      const { coverage, hash } = summarizeLocale(rows);
      probes.push({ locale: loc, rows, hash, coverage, csv: outCsv });
      log.info(`[detect] ${loc}: exported ${rows.length} rows, coverage ${(coverage*100).toFixed(1)}%`);
    } catch (err: any) {
      log.warn(`[detect] ${loc}: error during export: ${err?.message || err}`);
    }
  }

  if (probes.length === 0) {
    log.info(`No locales could be exported. Exiting.`);
    process.exit(0);
  }

  // Pass 2: collapse duplicates by hash using canonical preference
  // Group by hash → pick canonical via canonicalOrder; mark the rest as aliases
  const groups = new Map<string, Probe[]>();
  for (const p of probes) {
    if (!groups.has(p.hash)) groups.set(p.hash, []);
    groups.get(p.hash)!.push(p);
  }

  const kept: Probe[] = [];
  const aliases: { alias: string; canonical: string }[] = [];
  const knownHashes = new Set<string>();

  for (const [hash, list] of groups.entries()) {
    // filter by coverage first (remove ones below MIN_COVERAGE entirely)
    const viable = list.filter(p => p.coverage >= MIN_COVERAGE);
    if (viable.length === 0) {
      // whole group is low-coverage (e.g., mostly $IDs) → drop
      const names = list.map(p => p.locale).join(', ');
      log.info(`[filter] drop ${names}: coverage too low for all`);
      continue;
    }

    // choose canonical per preference order
    const pick = viable.slice().sort((a, b) => {
      const ia = canonicalOrder.indexOf(a.locale); const ib = canonicalOrder.indexOf(b.locale);
      const A = ia >= 0 ? ia : Number.MAX_SAFE_INTEGER;
      const B = ib >= 0 ? ib : Number.MAX_SAFE_INTEGER;
      return A - B;
    })[0];

    if (!knownHashes.has(hash)) {
      kept.push(pick);
      knownHashes.add(hash);
    }

    // everything else in the group becomes an alias of the canonical
    for (const other of viable) {
      if (other.locale === pick.locale) continue;
      aliases.push({ alias: other.locale, canonical: pick.locale });
    }

    // if there were non-viable in the group, we ignore them silently (they're low-coverage)
  }

  // Optional: print alias mapping for transparency
  if (aliases.length) {
    const byCanon = new Map<string,string[]>();
    for (const a of aliases) {
      if (!byCanon.has(a.canonical)) byCanon.set(a.canonical, []);
      byCanon.get(a.canonical)!.push(a.alias);
    }
    for (const [canon, ali] of byCanon.entries()) {
      log.info(`[alias] ${ali.join(', ')} → alias of ${canon} (identical content)`);
    }
  }

  if (kept.length < 2) {
    log.info(`No distinct locale pairs found after collapsing duplicates. Kept: ${kept.map(k => k.locale).join(', ') || 'none'}`);
    process.exit(0);
  }

  // Pass 3: ingest kept locales into DB
  const idsPerLocale: Record<string,{recordId:number,stringId:number}[]> = {};
  for (const k of kept) {
    idsPerLocale[k.locale] = await ingestCsvRows(db, modId, k.rows, k.locale, 'builtin');
    log.info(`[ingest] ${k.locale}: ${k.rows.length} rows inserted`);
  }

  // Build alignment pairs
  const defaultPairs = allPairs(kept.map(k => k.locale));
  const pairSpecs = argv.pairs ? (argv.pairs as string[]) : defaultPairs;

  for (const spec of pairSpecs) {
    const [src, tgt] = (spec as string).split(':');
    const L = kept.find(k => k.locale === src);
    const R = kept.find(k => k.locale === tgt);
    if (!L || !R) {
      log.info(`[align] skip ${spec} (one side missing after dedup)`);
      continue;
    }

    // Prepare rows with Hash anchors (quick local recompute)
    const left = L.rows.map(r => ({ ...r, Hash: sha1Hex(normalizeForHash(r.Source)) }));
    const right = R.rows.map(r => ({ ...r, Hash: sha1Hex(normalizeForHash(r.Source)) }));

    const pairs = await alignPairs(left, right, {
      fuzzyMin: Number(argv.fuzzyMin),
      fuzzyStrong: Number(argv.fuzzyStrong),
      useEmbeddings: Boolean(argv.useEmbeddings),
      embedModel: getEmbedModel()
    });

    for (const ap of pairs) {
      const srcStrId = idsPerLocale[src][ap.leftIndex].stringId;
      const tgtText = right[ap.rightIndex].Source;
      const status = ap.method === 'rapidfuzz' ? 'fuzzy' : 'tm';
      await addTranslation(db, srcStrId, tgt, tgtText, status, ap.score, ap.method);
    }
    log.info(`[align] ${src}→${tgt}: ${pairs.length} aligned rows`);
  }

  log.info(`Done. Kept locales: ${kept.map(k => `${k.locale}(${(k.coverage*100).toFixed(1)}%)`).join(', ')}`);
  if (aliases.length) {
    log.info(`Aliases collapsed: ${aliases.length} (see logs above).`);
  }
})().catch(e => {
  log.error(e);
  process.exit(1);
});
