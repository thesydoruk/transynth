#!/usr/bin/env tsx
/**
 * importMod.ts
 *
 * Native mod import — reads strings directly from ESP/ESM/ESL + BA2.
 *
 * Modes
 * -----
 * Default (single locale):
 *   Import strings for one locale from a mod into the DB.
 *
 * --learn mode:
 *   Import ALL locales found in the BA2, then align each non-source locale
 *   against the source locale and write TM pairs.
 *
 * BA2 auto-discovery
 * ------------------
 * If --ba2 is omitted, the script looks for a file named
 * "<ModStem> - Main.ba2" or "<ModStem>.ba2" in the same directory as the ESP.
 * Loose .STRINGS files in a "Strings\" folder next to the ESP are also supported.
 *
 * Usage examples
 * --------------
 * Single locale:
 *   tsx src/cli/importMod.ts --mod path/to/Mod.esp --lang en
 *
 * Multi-locale TM learning:
 *   tsx src/cli/importMod.ts --mod path/to/Mod.esp --learn --srcLang en --tgtLang uk
 *
 * Explicit BA2:
 *   tsx src/cli/importMod.ts --mod path/to/Mod.esp --ba2 path/to/Mod.ba2 --lang en
 */

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { openDb, upsertMod, addTranslation, closeDb } from '../db.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { sha1Hex } from '../utils/hash.js';
import { ingestCsvRows } from '../utils/ingest.js';
import { alignPairs } from '../align/alignPairs.js';
import { log } from '../logger.js';
import type { CsvRow } from '../types.js';

import { EspReader } from '../bethesda/espReader.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import { parseStringsBuffer, stringsTypeFromPath } from '../bethesda/stringsFile.js';

// ────────────────────────────────────────────────────────────────────────────
// CLI args
// ────────────────────────────────────────────────────────────────────────────

const argv = await yargs(hideBin(process.argv))
  .option('mod',     { type: 'string', demandOption: true,  desc: 'Path to the .esp/.esm/.esl file' })
  .option('ba2',     { type: 'string',                      desc: 'Path to the BA2 archive (auto-detected if omitted)' })
  .option('lang',    { type: 'string', default: 'en',       desc: 'Locale to import in single-locale mode' })
  .option('learn',   { type: 'boolean', default: false,     desc: 'Import all locales and build TM pairs' })
  .option('srcLang', { type: 'string', default: 'en',       desc: '[--learn] Source locale for TM alignment' })
  .option('tgtLang', { type: 'string', default: 'uk',       desc: '[--learn] Target locale for TM alignment' })
  .option('fuzzyMin',{ type: 'number', default: 85,         desc: '[--learn] Minimum fuzzy score for TM pair' })
  .parse();

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discover a BA2 archive near the ESP if --ba2 was not provided.
 * Checks for "<name> - Main.ba2" and "<name>.ba2" in the same directory.
 */
function discoverBa2(modPath: string): string | null {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath));

  for (const candidate of [`${stem} - Main.ba2`, `${stem}.ba2`]) {
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Load all STRINGS/DLSTRINGS/ILSTRINGS files from a BA2 archive,
 * grouped by locale (lower-case, e.g. "en", "ru").
 * Returns a Map<locale, Map<lstringId, text>>.
 */
function loadLocalesFromBA2(ba2Path: string): Map<string, Map<number, string>> {
  const reader = new Ba2Reader(ba2Path);
  const locales = new Map<string, Map<number, string>>();

  const stringsEntries = [
    ...reader.listByExt('strings'),
    ...reader.listByExt('dlstrings'),
    ...reader.listByExt('ilstrings'),
  ];

  for (const entry of stringsEntries) {
    // Name pattern: Strings\ModName_en.STRINGS — extract locale after last '_'
    const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
    const m = base.match(/_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
    if (!m) continue;

    const locale = m[1].toLowerCase();
    const type = stringsTypeFromPath(entry.name);
    const buf = reader.extractEntry(entry);
    const map = parseStringsBuffer(buf, type);

    if (!locales.has(locale)) locales.set(locale, new Map());
    const localeMap = locales.get(locale)!;
    for (const [id, text] of map) localeMap.set(id, text);
  }

  return locales;
}

/**
 * Load STRINGS/DLSTRINGS/ILSTRINGS from loose files next to the ESP.
 * Looks in a "Strings\" sub-directory.
 */
function loadLocalesFromLooseFiles(modPath: string): Map<string, Map<number, string>> {
  const dir = path.join(path.dirname(modPath), 'Strings');
  const locales = new Map<string, Map<number, string>>();
  if (!fs.existsSync(dir)) return locales;

  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
    if (!m) continue;

    const locale = m[1].toLowerCase();
    const type = stringsTypeFromPath(file);
    const buf = fs.readFileSync(path.join(dir, file));
    const map = parseStringsBuffer(buf, type);

    if (!locales.has(locale)) locales.set(locale, new Map());
    const localeMap = locales.get(locale)!;
    for (const [id, text] of map) localeMap.set(id, text);
  }

  return locales;
}

/**
 * Convert EspReader rows + resolved strings map into CsvRow[] for ingest.
 * For non-localized plugins, espRows already contain the text in row.text.
 */
function buildCsvRows(
  espRows: Awaited<ReturnType<EspReader['extractStrings']>>,
  stringsMap: Map<number, string> | null,
): CsvRow[] {
  const rows: CsvRow[] = [];

  for (const row of espRows) {
    let text: string;

    if (row.isLstringId) {
      if (!stringsMap) continue; // cannot resolve without strings files
      const id = parseInt(row.text, 10);
      text = stringsMap.get(id) ?? '';
      if (!text) continue; // skip unresolved IDs
    } else {
      text = row.text;
    }

    rows.push({
      FormID:    row.formId,
      Signature: row.signature,
      EDID:      row.edid || undefined,
      Path:      `${row.signature}\\${row.path}`,
      Source:    text,
    });
  }

  return rows;
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

const modPath = path.resolve(argv.mod);
if (!fs.existsSync(modPath)) {
  log.error(`Mod not found: ${modPath}`);
  process.exit(1);
}

const db = openDb();
const modHash = sha1Hex(fs.readFileSync(modPath));
const modId = await upsertMod(db, path.basename(modPath), modPath, modHash);
log.info(`Mod registered: ${path.basename(modPath)} (id=${modId})`);

// Parse ESP
const esp = new EspReader(modPath);
const espRows = esp.extractStrings();
log.info(`ESP rows extracted: ${espRows.length} (localized=${esp.info.isLocalized})`);

// Locate STRINGS source
let localesMap: Map<string, Map<number, string>> = new Map();
if (esp.info.isLocalized) {
  const ba2Path = argv.ba2 ? path.resolve(argv.ba2) : discoverBa2(modPath);

  if (ba2Path && fs.existsSync(ba2Path)) {
    log.info(`Loading STRINGS from BA2: ${ba2Path}`);
    localesMap = loadLocalesFromBA2(ba2Path);
  } else {
    log.info('No BA2 found, trying loose STRINGS files…');
    localesMap = loadLocalesFromLooseFiles(modPath);
  }

  log.info(`Locales available: ${[...localesMap.keys()].join(', ') || '(none)'}`);
}

// ── Single-locale mode ────────────────────────────────────────────────────
if (!argv.learn) {
  const lang = argv.lang;
  const stringsMap = esp.info.isLocalized ? (localesMap.get(lang) ?? null) : null;

  if (esp.info.isLocalized && !stringsMap) {
    log.error(`Locale "${lang}" not found in STRINGS. Available: ${[...localesMap.keys()].join(', ')}`);
    process.exit(1);
  }

  const rows = buildCsvRows(espRows, stringsMap);
  if (rows.length === 0) {
    log.warn('No translatable rows found.');
    process.exit(0);
  }

  rows.forEach(r => { (r as Record<string, unknown>).Hash = sha1Hex(normalizeForHash(r.Source)); });
  await ingestCsvRows(db, modId, rows, lang, 'native');
  log.info(`Ingested ${rows.length} rows for locale "${lang}".`);
  await closeDb();
  process.exit(0);
}

// ── Learn mode (all locales) ───────────────────────────────────────────────
const srcLang = argv.srcLang;
const tgtLang = argv.tgtLang;

// Determine locales to process
const availableLocales = esp.info.isLocalized
  ? [...localesMap.keys()]
  : [srcLang]; // non-localized: only one "locale"

if (availableLocales.length === 0) {
  log.error('No locales found. Cannot learn.');
  process.exit(1);
}

// Ingest each locale
const ingestedIds = new Map<string, { recordId: number; stringId: number }[]>();

for (const locale of availableLocales) {
  const stringsMap = esp.info.isLocalized ? (localesMap.get(locale) ?? null) : null;
  const rows = buildCsvRows(espRows, stringsMap);
  rows.forEach(r => { (r as Record<string, unknown>).Hash = sha1Hex(normalizeForHash(r.Source)); });

  const ids = await ingestCsvRows(db, modId, rows, locale, 'native');
  ingestedIds.set(locale, ids);
  log.info(`Ingested ${rows.length} rows for locale "${locale}".`);
}

// Align source vs each target locale
const srcRows = buildCsvRows(espRows, esp.info.isLocalized ? (localesMap.get(srcLang) ?? null) : null);
const srcIds = ingestedIds.get(srcLang);

if (!srcIds || srcRows.length === 0) {
  log.warn(`Source locale "${srcLang}" has no rows — skipping TM alignment.`);
  process.exit(0);
}

const targetLocales = availableLocales.filter(l => l !== srcLang);

for (const locale of targetLocales) {
  const tgtRows = buildCsvRows(espRows, esp.info.isLocalized ? (localesMap.get(locale) ?? null) : null);
  if (tgtRows.length === 0) continue;

  const pairs = await alignPairs(srcRows, tgtRows, {
    fuzzyMin: argv.fuzzyMin,
    fuzzyStrong: 90,
    useEmbeddings: false,
  });

  for (const p of pairs) {
    const srcStringId = srcIds[p.leftIndex].stringId;
    const tgtText = tgtRows[p.rightIndex].Source;
    await addTranslation(db, srcStringId, locale, tgtText,
      p.method === 'rapidfuzz' ? 'fuzzy' : 'tm', p.score, p.method);
  }

  log.info(`TM: ${srcLang} → ${locale}: ${pairs.length} pairs aligned.`);
}

// Also emit src→tgtLang if srcLang is not tgtLang and a tgtLang file exists
if (!targetLocales.includes(tgtLang) && tgtLang !== srcLang) {
  log.warn(`Target locale "${tgtLang}" not found among available: ${availableLocales.join(', ')}`);
}

log.info('Import complete.');
