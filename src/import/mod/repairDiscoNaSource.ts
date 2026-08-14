/**
 * Replace Disco source strings stored as msgid placeholder `N/A` with msgstr
 * from the original Final Cut `.po` extract.
 */
import fs from 'node:fs';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { PATHS } from '../../paths';
import { sha1Hex } from '../../utils/hash';
import { normalizeForHash, normalizeNoPunct } from '../../utils/textNorm';
import { collectDiscoPoLocales, resolveDiscoPoSourceLocale } from './discoPoLocales';
import { isDiscoPlaceholderMsgid } from './discoPoText';

export type DiscoNaSourceTarget = {
  id: number;
  name: string;
  extract_dir: string;
  src_lang: string;
};

export type RepairDiscoNaSourceResult = {
  modId: number;
  scanned: number;
  updated: number;
};

const resolveExtractDir = (extractDir: string): string => {
  if (fs.existsSync(extractDir)) return extractDir;
  const mapped = extractDir.replace(/^[/\\]app[/\\]data(?=[/\\]|$)/, PATHS.dataDir);
  if (mapped !== extractDir && fs.existsSync(mapped)) return mapped;
  return extractDir;
};

export const listDiscoModsWithExtract = async (
  db: Tx,
  modId?: number,
): Promise<DiscoNaSourceTarget[]> => {
  const { rows } = await db.query<DiscoNaSourceTarget>(
    `SELECT m.id, m.name, mi.extract_dir, mi.src_lang
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id
     WHERE m.game = 'disco'
       AND mi.extract_dir IS NOT NULL AND mi.extract_dir <> ''
       AND ($1::int IS NULL OR m.id = $1)
     ORDER BY m.id`,
    [modId ?? null],
  );
  return rows;
};

const loadPlaceholderUpdates = (extractDir: string): Map<string, string> => {
  const locales = collectDiscoPoLocales(extractDir);
  const sourceLocale = resolveDiscoPoSourceLocale(locales);
  if (!sourceLocale) return new Map();
  const bundle = locales.get(sourceLocale);
  if (!bundle) return new Map();

  const byPath = new Map<string, string>();
  for (const [compositeKey, text] of bundle.entries) {
    if (!text.trim() || isDiscoPlaceholderMsgid(text)) continue;
    byPath.set(`PO\\${compositeKey}`, text);
  }
  return byPath;
};

export const repairDiscoNaSourceForMod = async (
  db: Tx,
  target: DiscoNaSourceTarget,
  opts: { dryRun?: boolean } = {},
): Promise<RepairDiscoNaSourceResult> => {
  const extractDir = resolveExtractDir(target.extract_dir);
  if (!fs.existsSync(extractDir)) {
    throw new Error(`Extract dir missing for mod ${target.id}: ${extractDir}`);
  }

  const byPath = loadPlaceholderUpdates(extractDir);
  const { rows } = await db.query<{ id: number; record_id: number; path: string }>(
    `SELECT s.id, s.record_id, r.path
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     WHERE r.mod_id = $1 AND s.text_raw = 'N/A'`,
    [target.id, target.src_lang || 'en'],
  );

  const updates: Array<{ id: number; recordId: number; text: string }> = [];
  for (const row of rows) {
    const text = byPath.get(row.path);
    if (!text) continue;
    updates.push({ id: row.id, recordId: row.record_id, text });
  }

  if (opts.dryRun || updates.length === 0) {
    return { modId: target.id, scanned: rows.length, updated: updates.length };
  }

  const chunk = CONFIG.dbChunkSize;
  for (let i = 0; i < updates.length; i += chunk) {
    const slice = updates.slice(i, i + chunk);
    const ids = slice.map((u) => u.id);
    const texts = slice.map((u) => u.text);
    const norms = texts.map((t) => normalizeForHash(t));
    const nopunct = texts.map((t) => normalizeNoPunct(t));
    const recordIds = slice.map((u) => u.recordId);
    const hashNorms = norms.map((n) => sha1Hex(n));

    await db.query(
      `UPDATE strings AS s
       SET text_raw = u.text_raw, text_norm = u.text_norm, text_norm_nopunct = u.nopunct
       FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[])
         AS u(id, text_raw, text_norm, nopunct)
       WHERE s.id = u.id AND s.text_raw = 'N/A'`,
      [ids, texts, norms, nopunct],
    );
    await db.query(
      `UPDATE records AS r
       SET hash_norm = u.hash_norm
       FROM UNNEST($1::int[], $2::text[]) AS u(id, hash_norm)
       WHERE r.id = u.id`,
      [recordIds, hashNorms],
    );
  }

  return { modId: target.id, scanned: rows.length, updated: updates.length };
};
