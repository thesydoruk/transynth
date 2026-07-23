import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import type { TranslationStatus } from '../statusMachine';
import { BEST_TRANSLATION_ORDER } from './constants';
import { upsertTranslation } from './translationsUpsert';

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
         AND t.id = (SELECT id FROM translations WHERE src_string_id = s.id AND target_lang = $1
                     ORDER BY ${BEST_TRANSLATION_ORDER} LIMIT 1)
       WHERE r.mod_id = $2 AND s.lang = $3`,
      [targetLang, modId, srcLang],
    );
    return rows as Row[];
  };

  const newRows = await fetchMod(newModId);
  const oldMap = new Map<string, Row>();
  for (const r of await fetchMod(oldModId)) oldMap.set(`${r.formid_hex}|${r.path}`, r);

  const added: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  let unchanged = 0;

  const newKeys = new Set<string>();
  for (const r of newRows) {
    const key = `${r.formid_hex}|${r.path}`;
    newKeys.add(key);
    const old = oldMap.get(key);
    if (!old) {
      added.push({ ...r, source: r.text_raw, changeType: 'added' });
    } else if (r.text_norm !== old.text_norm) {
      changed.push({ ...r, source: r.text_raw, changeType: 'changed' });
    } else {
      unchanged++;
    }
  }

  const removed: DiffEntry[] = [];
  for (const [key, r] of oldMap) {
    if (!newKeys.has(key)) {
      removed.push({ ...r, source: r.text_raw, changeType: 'removed' });
    }
  }

  return { added, removed, changed, unchanged };
};

/**
 * Carries over translations from an older mod version to a newer one.
 *
 * For each string in the new mod version that also exists in the old version
 * (matched by FormID + path identity key):
 *
 * - **Unchanged source**: The translation is copied as-is with its original status.
 * - **Changed source**: The translation is copied but marked as 'draft' so the
 *   translator can review it for the updated source text.
 *
 * Strings that already have a translation in the new version are skipped.
 * Strings that only exist in the old version (removed) are ignored.
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
  // Step 1: Fetch all strings in the new mod with their normalized source text
  const { rows: newStrings } = await db.query(
    `SELECT s.id AS string_id, r.formid_hex, r.path, s.text_norm
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $2`,
    [newModId, srcLang],
  );

  // Step 2: Fetch all strings in the old mod with their best translation
  const { rows: oldStrings } = await db.query(
    `SELECT r.formid_hex, r.path, s.text_norm,
            t.text AS translation, t.status, t.provenance, t.model
     FROM strings s
     JOIN records r ON s.record_id = r.id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       AND t.id = (
         SELECT id FROM translations
         WHERE src_string_id = s.id AND target_lang = $2
         ORDER BY ${BEST_TRANSLATION_ORDER} LIMIT 1
       )
     WHERE r.mod_id = $1 AND s.lang = $3`,
    [oldModId, targetLang, srcLang],
  );

  // Build lookup map: identity key → old translation data
  type OldEntry = {
    text_norm: string;
    translation: string;
    status: string;
    provenance: string | null;
    model: string | null;
  };
  const oldMap = new Map<string, OldEntry>();
  for (const r of oldStrings as Array<{ formid_hex: string; path: string } & OldEntry>) {
    oldMap.set(`${r.formid_hex}|${r.path}`, r);
  }

  // Step 3: Check which new strings already have translations (skip those)
  const newStringIds = (newStrings as Array<{ string_id: number }>).map((r) => r.string_id);
  const alreadyTranslated = new Set<number>();
  if (newStringIds.length > 0) {
    const { rows: existing } = await db.query(
      `SELECT DISTINCT src_string_id FROM translations
       WHERE src_string_id = ANY($1) AND target_lang = $2`,
      [newStringIds, targetLang],
    );
    for (const r of existing as Array<{ src_string_id: number }>) {
      alreadyTranslated.add(r.src_string_id);
    }
  }

  // Step 4: Copy translations for matching strings
  let carried = 0;
  let needsReview = 0;
  let skipped = 0;

  for (const row of newStrings as Array<{
    string_id: number;
    formid_hex: string;
    path: string;
    text_norm: string;
  }>) {
    if (alreadyTranslated.has(row.string_id)) {
      skipped++;
      continue;
    }

    const key = `${row.formid_hex}|${row.path}`;
    const old = oldMap.get(key);
    if (!old) continue; // String doesn't exist in old version

    // Determine status: keep original status if source unchanged, else mark as draft
    const sourceChanged = row.text_norm !== old.text_norm;
    const newStatus = sourceChanged ? 'draft' : old.status;
    const provenance = `carry_over_from_mod_${oldModId}`;

    await upsertTranslation(
      db,
      row.string_id,
      old.translation,
      newStatus as Exclude<TranslationStatus, 'deleted'>,
      targetLang,
      provenance,
      old.model ?? undefined,
    );

    if (sourceChanged) {
      needsReview++;
    } else {
      carried++;
    }
  }

  log.info(
    `Carry-over: ${carried} carried, ${needsReview} need review, ${skipped} skipped (already translated)`,
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
