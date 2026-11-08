import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import type { TranslationStatus } from '../statusMachine';
import { upsertTranslation } from './translationsUpsert';
import { pairVersionStrings } from './importDiffMatch';

// ── Mod diff ──────────────────────────────────────────────────────────────────

export type DiffEntry = {
  formid_hex: string;
  path: string;
  signature: string;
  edid: string | null;
  source: string;
  translation: string | null;
  status: string | null;
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
};

export const diffMods = async (
  db: Tx,
  newModId: number,
  oldModId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  unchanged: number;
}> => {
  type Row = {
    formid_hex: string;
    path: string;
    signature: string;
    edid: string | null;
    text_raw: string;
    text_norm: string;
    translation: string | null;
    status: string | null;
  };

  const fetchMod = async (modId: number) => {
    const { rows } = await db.query(
      `SELECT r.formid_hex, r.path, r.signature, r.edid,
              s.text_raw, s.text_norm,
              t.text AS translation, t.status
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       WHERE r.mod_id = $2 AND s.lang = $3
       ORDER BY r.id, s.id`,
      [targetLang, modId, srcLang],
    );
    return rows as Row[];
  };

  const entry = (r: Row, changeType: DiffEntry['changeType']): DiffEntry => ({
    ...r,
    source: r.text_raw,
    changeType,
  });

  const pairing = pairVersionStrings(await fetchMod(newModId), await fetchMod(oldModId));
  const changed: DiffEntry[] = [];
  let unchanged = 0;
  for (const pair of pairing.pairs) {
    if (pair.sourceChanged) changed.push(entry(pair.next, 'changed'));
    else unchanged++;
  }

  return {
    added: pairing.unmatchedNew.map((r) => entry(r, 'added')),
    removed: pairing.unmatchedOld.map((r) => entry(r, 'removed')),
    changed,
    unchanged,
  };
};

/**
 * Carries over translations from an older mod version to a newer one.
 *
 * Strings are paired per record by {@link pairVersionStrings}: siblings on one
 * FormID + path by identical normalised source, and a lone leftover on each
 * side as a changed source.
 *
 * - **Unchanged source**: The translation is copied as-is with its original status.
 * - **Changed source**: The translation is copied but marked as 'draft' so the
 *   translator can review it for the updated source text.
 *
 * Strings that already have a translation in the new version are skipped.
 * Strings without a counterpart in the old version — added, removed, or one of
 * several changed siblings of a record — are left alone.
 *
 * @param db - Database connection
 * @param newModId - The ID of the newly imported mod version
 * @param oldModId - The ID of the previous mod version to copy translations from
 * @param targetLang - Target language code (e.g. 'uk')
 * @returns Summary of carried-over, needs-review, and skipped counts
 */
export const carryOverTranslations = async (
  db: Tx,
  newModId: number,
  oldModId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ carried: number; needsReview: number; skipped: number }> => {
  type NewRow = { string_id: number; formid_hex: string; path: string; text_norm: string };
  type OldRow = {
    formid_hex: string;
    path: string;
    text_norm: string;
    translation: string | null;
    status: string | null;
    provenance: string | null;
    model: string | null;
  };

  // Step 1: Fetch all strings in the new mod with their normalized source text
  const { rows: newStrings } = await db.query<NewRow>(
    `SELECT s.id AS string_id, r.formid_hex, r.path, s.text_norm
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $2
     ORDER BY r.id, s.id`,
    [newModId, srcLang],
  );

  // Step 2: Fetch all strings in the old mod with their translation, if any.
  // Untranslated siblings still take part in the pairing so that a changed
  // sibling is not mistaken for the only one in its record.
  const { rows: oldStrings } = await db.query<OldRow>(
    `SELECT r.formid_hex, r.path, s.text_norm,
            t.text AS translation, t.status, t.provenance, t.model
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1 AND s.lang = $3
     ORDER BY r.id, s.id`,
    [oldModId, targetLang, srcLang],
  );

  // Step 3: Check which new strings already have translations (skip those)
  const newStringIds = newStrings.map((r) => r.string_id);
  const alreadyTranslated = new Set<number>();
  if (newStringIds.length > 0) {
    const { rows: existing } = await db.query<{ src_string_id: number }>(
      `SELECT DISTINCT src_string_id FROM translations
       WHERE src_string_id = ANY($1) AND target_lang = $2`,
      [newStringIds, targetLang],
    );
    for (const r of existing) alreadyTranslated.add(r.src_string_id);
  }

  // Step 4: Copy translations for paired strings
  let carried = 0;
  let needsReview = 0;
  let skipped = 0;
  const pairing = pairVersionStrings(newStrings, oldStrings);
  const provenance = `carry_over_from_mod_${oldModId}`;

  for (const { next, old, sourceChanged } of pairing.pairs) {
    if (old.translation === null || old.status === null) continue;
    if (alreadyTranslated.has(next.string_id)) {
      skipped++;
      continue;
    }

    // Keep the original status if the source is unchanged, else mark as draft
    const newStatus = sourceChanged ? 'draft' : old.status;
    await upsertTranslation(
      db,
      next.string_id,
      old.translation,
      newStatus as Exclude<TranslationStatus, 'deleted'>,
      targetLang,
      provenance,
      old.model ?? undefined,
    );

    if (sourceChanged) needsReview++;
    else carried++;
  }

  log.info(
    `Carry-over: ${carried} carried, ${needsReview} need review, ${skipped} skipped (already translated), ` +
      `${pairing.unmatchedNew.length} new strings without a counterpart`,
  );
  return { carried, needsReview, skipped };
};

// ── Previous versions ─────────────────────────────────────────────────────────

/**
 * Row returned by {@link listPreviousVersions} — one per older mod version
 * sharing the same name but a different file hash.
 */
export type PreviousVersionRow = {
  id: number;
  name: string;
  version_hash: string;
  created_at: string;
  total_strings: number;
  translated_strings: number;
};

/**
 * Lists all other mod rows that share the same `name` as the given mod but
 * have a different `version_hash` (i.e. different file content).
 *
 * This is used after import to detect whether a previous version of the same
 * mod already exists so the user can be prompted to carry over translations.
 *
 * @param db    - Database connection
 * @param modId - The newly imported mod ID
 * @returns Array of previous-version summaries, newest first
 */
export const listPreviousVersions = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
): Promise<PreviousVersionRow[]> => {
  const { rows } = await db.query(
    `SELECT m.id, m.name, m.version_hash, m.created_at::text,
            COUNT(DISTINCT s.id)::int                  AS total_strings,
            COUNT(DISTINCT t.src_string_id)::int       AS translated_strings
     FROM mods m
     LEFT JOIN records r ON r.mod_id = m.id
     LEFT JOIN strings s ON s.record_id = r.id AND s.lang = $2
     LEFT JOIN translations t ON t.src_string_id = s.id
     WHERE m.name = (SELECT name FROM mods WHERE id = $1)
       AND m.id != $1
     GROUP BY m.id
     ORDER BY m.created_at DESC`,
    [modId, srcLang],
  );
  return rows as PreviousVersionRow[];
};
