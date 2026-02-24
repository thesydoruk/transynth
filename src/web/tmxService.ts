/**
 * TMX (Translation Memory eXchange) import/export service.
 *
 * TMX 1.4b is the industry-standard XML format for exchanging TM data between
 * translation tools. This module supports:
 *   - Export: query all approved translations and emit a valid TMX 1.4b file.
 *   - Import: parse a TMX file, match source segments by text_norm, and
 *     upsert translations for strings that don't already have a human/reviewed one.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Tx } from '../db.js';
import { withTransaction } from '../db.js';
import type pg from 'pg';
import { log } from '../logger.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { upsertTranslation } from './queries.js';
import { CONFIG } from '../config.js';

/* ── Types ─────────────────────────────────────────────────────────────────── */

/** A single translation unit as represented in TMX XML */
interface TmxTu {
  srcLang: string;
  srcText: string;
  tgtLang: string;
  tgtText: string;
}

/** Result returned after importing a TMX file */
export interface TmxImportResult {
  /** Number of TUs parsed from input TMX */
  parsed: number;
  /** Number of translations actually inserted into the DB */
  imported: number;
  /** Number of TUs skipped (no matching source or existing better translation) */
  skipped: number;
}

/* ── Export ─────────────────────────────────────────────────────────────────── */

/**
 * Escapes special XML characters in a string.
 * Prevents XML injection by encoding &, <, >, ", and '.
 */
const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Export all translations for a given mod (or all mods) as a TMX 1.4b XML string.
 *
 * @param db       Database connection or pool
 * @param srcLang  Source language code (default 'en')
 * @param tgtLang  Target language code (default 'uk')
 * @param modId    If provided, only export translations for this mod; otherwise export all
 * @returns        A UTF-8 string containing the complete TMX document
 */
export const exportTmx = async (
  db: Tx,
  srcLang = CONFIG.defaultSrcLang,
  tgtLang = CONFIG.defaultTgtLang,
  modId?: number,
): Promise<string> => {
  /* Query: join strings → translations, optionally filtered by mod */
  const modFilter = modId != null ? 'AND r.mod_id = $3' : '';
  const params: (string | number)[] = [srcLang, tgtLang];
  if (modId != null) params.push(modId);

  const { rows } = await db.query(
    `SELECT s.text_raw AS src_text, t.text AS tgt_text
     FROM strings s
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     JOIN records r ON s.record_id = r.id
     WHERE s.lang = $1
       ${modFilter}
     ORDER BY s.id`,
    params,
  );

  log.info(`TMX export: ${rows.length} translation units for srcLang=${srcLang} tgtLang=${tgtLang}${modId != null ? ` modId=${modId}` : ''}`);

  /* Build the TMX XML string manually for full control over format */
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tmx version="1.4">',
    `  <header creationtool="FO4 Localizer" creationtoolversion="1.0" datatype="plaintext" segtype="sentence" adminlang="${escapeXml(srcLang)}" srclang="${escapeXml(srcLang)}" />`,
    '  <body>',
  ];

  for (const row of rows) {
    const src = row.src_text as string;
    const tgt = row.tgt_text as string;
    lines.push(
      '    <tu>',
      `      <tuv xml:lang="${escapeXml(srcLang)}">`,
      `        <seg>${escapeXml(src)}</seg>`,
      '      </tuv>',
      `      <tuv xml:lang="${escapeXml(tgtLang)}">`,
      `        <seg>${escapeXml(tgt)}</seg>`,
      '      </tuv>',
      '    </tu>',
    );
  }

  lines.push('  </body>', '</tmx>', '');

  return lines.join('\n');
};

/* ── Import ────────────────────────────────────────────────────────────────── */

/**
 * Parse a TMX XML buffer into an array of translation unit objects.
 *
 * Handles both single-TU and multi-TU files, and supports the common
 * pattern where <tuv> elements contain an xml:lang attribute identifying
 * the language.
 *
 * @param buffer  Raw TMX file content (Buffer or string)
 * @returns       Array of parsed translation units with source and target text
 */
const parseTmxUnits = (buffer: Buffer | string): TmxTu[] => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    /* Ensure <tu> and <tuv> are always arrays even if there's only one */
    isArray: (name) => name === 'tu' || name === 'tuv',
  });

  const doc = parser.parse(typeof buffer === 'string' ? buffer : buffer.toString('utf-8'));

  /* Navigate to the <body> element which contains all <tu> units */
  const body = doc?.tmx?.body;
  if (!body?.tu) return [];

  const srcLangHeader: string = (doc.tmx?.header?.['@_srclang'] ?? 'en').toLowerCase();

  const units: TmxTu[] = [];

  for (const tu of body.tu as Record<string, unknown>[]) {
    const tuvs = tu.tuv as Record<string, unknown>[] | undefined;
    if (!tuvs || tuvs.length < 2) continue;

    let srcText = '';
    let srcLang = '';
    let tgtText = '';
    let tgtLang = '';

    for (const tuv of tuvs) {
      const lang = ((tuv['@_xml:lang'] ?? tuv['@_lang'] ?? '') as string).toLowerCase();
      const seg = typeof tuv.seg === 'string' ? tuv.seg : String(tuv.seg ?? '');

      if (lang === srcLangHeader || (!srcText && !tgtLang)) {
        srcText = seg;
        srcLang = lang || srcLangHeader;
      } else {
        tgtText = seg;
        tgtLang = lang;
      }
    }

    if (srcText && tgtText) {
      units.push({ srcLang, srcText, tgtLang, tgtText });
    }
  }

  return units;
};

/**
 * Import a TMX file into the database.
 *
 * For each translation unit, the source text is normalised and matched
 * against existing strings in the DB. A translation is inserted only when:
 *   - A matching source string exists (by text_norm)
 *   - The string doesn't already have a 'reviewed' or 'human' translation
 *
 * Imported translations get status 'tm' with provenance 'tmx_import'.
 *
 * @param db      Database pool
 * @param buffer  Raw TMX file content
 * @param modId   If provided, only match against strings belonging to this mod
 * @returns       Summary of parsed/imported/skipped counts
 */
export const importTmx = async (
  db: pg.Pool,
  buffer: Buffer | string,
  modId?: number,
): Promise<TmxImportResult> => {
  const units = parseTmxUnits(buffer);
  log.info(`TMX import: parsed ${units.length} translation units`);

  if (units.length === 0) return { parsed: 0, imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  await withTransaction(db, async (client) => {
    for (const tu of units) {
      /* Normalise the source text to find matching strings in DB */
      const norm = normalizeForHash(tu.srcText);

      /* Find all strings with this normalised source text */
      const params: (string | number)[] = [norm, tu.tgtLang, tu.srcLang || CONFIG.defaultSrcLang];
      let modFilter = '';
      if (modId != null) {
        params.push(modId);
        modFilter = `AND r.mod_id = $${params.length}`;
      }

      const { rows: matches } = await client.query(
        `SELECT s.id FROM strings s
         JOIN records r ON s.record_id = r.id
         WHERE s.text_norm = $1 AND s.lang = $3
           ${modFilter}
           AND NOT EXISTS (
             SELECT 1 FROM translations t
             WHERE t.src_string_id = s.id
               AND t.target_lang = $2
               AND t.status IN ('reviewed', 'human')
           )`,
        params,
      );

      if (matches.length === 0) {
        skipped++;
        continue;
      }

      /* Insert/upsert translation for each matching string */
      for (const m of matches) {
        await upsertTranslation(
          client,
          m.id as number,
          tu.tgtText,
          'tm',
          tu.tgtLang,
          'tmx_import',
        );
      }

      imported++;
    }
  });

  log.info(`TMX import complete: imported=${imported}, skipped=${skipped}`);
  return { parsed: units.length, imported, skipped };
};
