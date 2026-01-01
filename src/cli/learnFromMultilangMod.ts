#!/usr/bin/env tsx
/**
 * learnFromMultilangMod.ts
 *
 * Purpose
 * -------
 * Harvest parallel text from a single multi-lingual Fallout 4 plugin and build a TM.
 * The script:
 *  - auto-detects official locales (en, fr, it, de, es, pl, ru, ja) that truly exist for the mod,
 *    even when STRINGS are packed inside BA2 (delegated to xEdit);
 *  - supports custom locales via --extraLocales (added to auto list) or --locales (full override);
 *  - exports per-locale CSV via xEdit + ExportTextForTranslation.pas (one locale per run);
 *  - computes per-locale coverage + content hash, filters out fake/fallback/empty locales;
 *  - detects "cloned locales" (identical content across locales) and collapses them into a single canonical locale
 *    using a stable preference order; the others become aliases and are not used to create duplicate TM pairs;
 *  - ingests accepted (non-aliased) locales into SQLite and aligns each src→tgt pair to populate TM.
 *
 * Duplicate/Cloned locales
 * ------------------------
 * Some mods ship multiple STRINGS files that are actually identical (e.g., all locales contain English text copied).
 * We detect this by hashing normalized content per-locale and collapsing locales with the same hash.
 * Canonical selection uses a priority order (default favors 'en', then fr, it, de, es, pl, ru, ja, then any extras).
 * Aliased locales are logged (e.g., "ru → alias of en") and skipped from pairing so we don't pollute TM with duplicates.
 *
 * How auto-detection works
 * ------------------------
 * xEdit exposes only one active locale per run. We emulate detection by launching xEdit with "-l:<lang>" for each
 * candidate. For each candidate we export CSV and compute:
 *  - coverage: share of non-empty rows that are not "$12345" IDs (typical when plugin is localized but STRINGS missing),
 *  - content hash: SHA1 of normalized concatenated texts.
 * A locale is accepted if coverage ≥ MIN_COVERAGE AND its hash is new (not identical to an already accepted/kept hash).
 *
 * Usage examples
 * --------------
 * 1) Auto-detect official locales, also try two customs (uk, zh):
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --xedit "D:\Tools\FO4Edit\FO4Edit.exe" \
 *      --exporter "./xedit/ExportTextForTranslation.pas" \
 *      --mod "D:\mods\BigQuest.esp" \
 *      --extraLocales uk,zh
 *
 * 2) Full override: only en,ru,uk (no auto-detection):
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --xedit "D:\Tools\FO4Edit\FO4Edit.exe" \
 *      --exporter "./xedit/ExportTextForTranslation.pas" \
 *      --mod "D:\mods\BigQuest.esp" \
 *      --locales en,ru,uk
 *
 * 3) Tweak duplicate resolution preference (prefer 'ru' over 'en' for identical content):
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --xedit "..." --exporter "..." --mod "..." \
 *      --extraLocales uk \
 *      --canonicalPrefer ru,en,fr,it,de,es,pl,ja,uk
 *
 * 4) Enable embeddings for ambiguous fuzzy matches:
 *    tsx src/cli/learnFromMultilangMod.ts \
 *      --xedit "..." --exporter "..." --mod "..." \
 *      --useEmbeddings
 */

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { openDb, upsertMod, upsertRecord, insertString, addTranslation } from '../db.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { sha1Hex } from '../utils/hash.js';
import type { CsvRow } from '../types.js';
import { alignPairs } from '../align/alignPairs.js';
import { getEmbedModel } from '../config.js';

// Reuse low-level process runner from xedit/runExport to add "-l:<lang>" flag
import { execChild } from '../xedit/runExport.js';

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

async function exportForLocale(xeditExe: string, exporterPas: string, pluginPath: string, locale: string, outCsv: string): Promise<boolean> {
  const pluginName = path.basename(pluginPath);
  const args = [
    `-l:${locale}`,
    '-quick', '-autoload',
    `-fo:"${pluginPath}"`,
    '-app:FO4Edit',
    `-script:"${exporterPas}"`,
    `-Argument:"${pluginName}|${outCsv}"`
  ];
  await execChild(xeditExe, args);
  try {
    const stat = fs.statSync(outCsv);
    if (stat.size === 0) return false;
    const lines = fs.readFileSync(outCsv, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.length > 1;
  } catch {
    return false;
  }
}

function readCsv(p: string): CsvRow[] {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines.shift()!;
  const cols = header.split(',').map(s => s.replace(/^"|"$/g,''));
  const idx = (name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());
  return lines.map(line => {
    const f = parseCsv(line);
    return {
      FormID: f[idx('FormID')],
      Signature: f[idx('Signature')],
      Path: f[idx('Path')],
      Source: f[idx('Source')],
      Hints: f[idx('Hints')] || ''
    };
  });
}

function parseCsv(line: string) {
  const parts: string[] = []; let cur = '', inQ=false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { parts.push(cur); cur=''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

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

/** Ingest rows into DB for given mod + locale. */
function ingestCsvRows(db: any, modId: number, rows: CsvRow[], lang: string, sourceKind: 'builtin'|'export') {
  return rows.map(r => {
    const pathSimplified = r.Path.replace(/\[\d+\]/g, '');
    const hashNorm = sha1Hex(normalizeForHash(r.Source));
    const recId = upsertRecord(db, modId, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
    const strId = insertString(db, recId, lang, r.Source, normalizeForHash(r.Source), sourceKind);
    return { recordId: recId, stringId: strId };
  });
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
  const modId = upsertMod(db, modName, path.resolve(modPath), modHash);

  // Resolve candidate locales
  let localesToTry: string[] = [];
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
        console.log(`[detect] ${loc}: no rows exported (unsupported or empty)`);
        continue;
      }
      const rows = readCsv(outCsv);
      const { coverage, hash } = summarizeLocale(rows);
      probes.push({ locale: loc, rows, hash, coverage, csv: outCsv });
      console.log(`[detect] ${loc}: exported ${rows.length} rows, coverage ${(coverage*100).toFixed(1)}%`);
    } catch (err: any) {
      console.warn(`[detect] ${loc}: error during export: ${err?.message || err}`);
    }
  }

  if (probes.length === 0) {
    console.log(`No locales could be exported. Exiting.`);
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
      console.log(`[filter] drop ${names}: coverage too low for all`);
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
      console.log(`[alias] ${ali.join(', ')} → alias of ${canon} (identical content)`);
    }
  }

  if (kept.length < 2) {
    console.log(`No distinct locale pairs found after collapsing duplicates. Kept: ${kept.map(k => k.locale).join(', ') || 'none'}`);
    process.exit(0);
  }

  // Pass 3: ingest kept locales into DB
  const idsPerLocale: Record<string,{recordId:number,stringId:number}[]> = {};
  for (const k of kept) {
    idsPerLocale[k.locale] = ingestCsvRows(db, modId, k.rows, k.locale, 'builtin');
    console.log(`[ingest] ${k.locale}: ${k.rows.length} rows inserted`);
  }

  // Build alignment pairs
  const defaultPairs = allPairs(kept.map(k => k.locale));
  const pairSpecs = argv.pairs ? (argv.pairs as string[]) : defaultPairs;

  for (const spec of pairSpecs) {
    const [src, tgt] = (spec as string).split(':');
    const L = kept.find(k => k.locale === src);
    const R = kept.find(k => k.locale === tgt);
    if (!L || !R) {
      console.log(`[align] skip ${spec} (one side missing after dedup)`);
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
      addTranslation(db, srcStrId, tgt, tgtText, status, ap.score, ap.method);
    }
    console.log(`[align] ${src}→${tgt}: ${pairs.length} aligned rows`);
  }

  console.log(`Done. Kept locales: ${kept.map(k => `${k.locale}(${(k.coverage*100).toFixed(1)}%)`).join(', ')}`);
  if (aliases.length) {
    console.log(`Aliases collapsed: ${aliases.length} (see logs above).`);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
