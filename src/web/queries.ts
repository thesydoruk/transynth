import type { Tx } from '../db.js';

// ── Mods ─────────────────────────────────────────────────────────────────────

export function listMods(db: Tx) {
  return db
    .prepare(
      `SELECT
        m.id,
        m.name,
        m.abs_path,
        m.version_hash,
        m.created_at,
        COUNT(DISTINCT r.id)          AS record_count,
        COUNT(DISTINCT s.id)          AS string_count,
        COUNT(DISTINCT t.id)          AS translated_count,
        COUNT(DISTINCT CASE WHEN t.status='human' THEN t.id END) AS approved_count,
        COUNT(DISTINCT CASE WHEN t.status='fuzzy'  THEN t.id END) AS fuzzy_count
       FROM mods m
       LEFT JOIN records r ON r.mod_id = m.id
       LEFT JOIN strings s ON s.record_id = r.id AND s.lang = 'en'
       LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
       GROUP BY m.id
       ORDER BY m.created_at DESC`,
    )
    .all();
}

export function getMod(db: Tx, id: number) {
  return db.prepare(`SELECT * FROM mods WHERE id = ?`).get(id);
}

// ── Strings ───────────────────────────────────────────────────────────────────

export type StringsFilter = {
  modId: number;
  status?: string;
  query?: string;
  signature?: string;
  page?: number;
  pageSize?: number;
};

export function listStrings(db: Tx, f: StringsFilter) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['r.mod_id = @modId'];
  const params: Record<string, unknown> = { modId: f.modId, limit: pageSize, offset };

  if (f.status && f.status !== 'all') {
    if (f.status === 'untranslated') {
      conditions.push('t.id IS NULL');
    } else {
      conditions.push('t.status = @status');
      params.status = f.status;
    }
  }

  if (f.signature) {
    conditions.push('r.signature = @signature');
    params.signature = f.signature;
  }

  if (f.query) {
    conditions.push(`(s.text_raw LIKE @query OR r.formid_hex LIKE @query OR r.edid LIKE @query)`);
    params.query = `%${f.query}%`;
  }

  const where = conditions.join(' AND ');

  const rows = db
    .prepare(
      `SELECT
        s.id            AS string_id,
        r.formid_hex,
        r.signature,
        r.path,
        r.edid,
        s.text_raw      AS source,
        t.id            AS translation_id,
        t.text          AS translation,
        t.status,
        t.confidence,
        t.provenance,
        t.model,
        t.updated_at
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = 'uk'
            AND t.id = (
              SELECT id FROM translations
              WHERE src_string_id = s.id AND target_lang = 'uk'
              ORDER BY CASE status
                WHEN 'human' THEN 1 WHEN 'tm' THEN 2
                WHEN 'fuzzy' THEN 3 WHEN 'auto' THEN 4 ELSE 5 END,
                COALESCE(confidence,0) DESC, created_at DESC
              LIMIT 1
            )
       WHERE s.lang = 'en' AND ${where}
       ORDER BY r.signature, r.path
       LIMIT @limit OFFSET @offset`,
    )
    .all(params);

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = 'uk'
       WHERE s.lang = 'en' AND ${where}`,
    )
    .get(params) as { total: number };

  return { rows, total: countRow.total, page, pageSize };
}

export function listSignatures(db: Tx, modId: number) {
  return db
    .prepare(
      `SELECT DISTINCT r.signature, COUNT(*) as count
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = 'en'
       WHERE r.mod_id = ?
       GROUP BY r.signature
       ORDER BY count DESC`,
    )
    .all(modId);
}

// ── Translations ──────────────────────────────────────────────────────────────

export function upsertTranslation(
  db: Tx,
  stringId: number,
  text: string,
  status: 'human' | 'fuzzy' | 'auto' | 'tm',
) {
  // Delete existing translation for this string+lang then insert fresh
  db.prepare(
    `DELETE FROM translations WHERE src_string_id = ? AND target_lang = 'uk'`,
  ).run(stringId);

  const info = db
    .prepare(
      `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, updated_at)
       VALUES (?, 'uk', ?, ?, 1.0, 'human_edit', CURRENT_TIMESTAMP)`,
    )
    .run(stringId, text, status);

  return { id: Number(info.lastInsertRowid), text, status };
}

export function updateTranslationStatus(db: Tx, translationId: number, status: string) {
  db.prepare(
    `UPDATE translations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(status, translationId);
}

// Returns text_norm for a string ID (used by propagation)
export function getStringTextNorm(db: Tx, stringId: number): string | null {
  const row = db
    .prepare(`SELECT text_norm FROM strings WHERE id = ?`)
    .get(stringId) as { text_norm: string } | undefined;
  return row?.text_norm ?? null;
}

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

export function diffMods(
  db: Tx,
  newModId: number,
  oldModId: number,
  targetLang = 'uk',
): { added: DiffEntry[]; removed: DiffEntry[]; changed: DiffEntry[]; unchanged: number } {
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

  const fetchMod = (modId: number) =>
    db
      .prepare(
        `SELECT r.formid_hex, r.path, r.signature, r.edid,
                s.text_raw, s.text_norm,
                t.text AS translation, t.status
         FROM strings s
         JOIN records r ON s.record_id = r.id
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = ?
           AND t.id = (SELECT id FROM translations WHERE src_string_id = s.id AND target_lang = ?
                       ORDER BY CASE status WHEN 'human' THEN 1 WHEN 'tm' THEN 2
                                            WHEN 'fuzzy' THEN 3 ELSE 4 END LIMIT 1)
         WHERE r.mod_id = ? AND s.lang = 'en'`,
      )
      .all(targetLang, targetLang, modId) as Row[];

  const newRows = fetchMod(newModId);
  const oldMap = new Map<string, Row>();
  for (const r of fetchMod(oldModId)) oldMap.set(`${r.formid_hex}|${r.path}`, r);

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
}

// ── Bulk search-replace ───────────────────────────────────────────────────────

export type SearchReplaceMatch = {
  translationId: number;
  stringId: number;
  formid_hex: string;
  path: string;
  originalText: string;
  newText: string;
};

export function searchReplaceTranslations(
  db: Tx,
  modId: number,
  search: string,
  replace: string,
  isRegex: boolean,
  targetLang: string,
  dryRun: boolean,
): { matches: SearchReplaceMatch[]; applied: number } {
  const rows = db
    .prepare(
      `SELECT t.id AS translation_id, t.text, t.src_string_id AS string_id,
              r.formid_hex, r.path
       FROM translations t
       JOIN strings s ON s.id = t.src_string_id AND s.lang = 'en'
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = ? AND t.target_lang = ?`,
    )
    .all(modId, targetLang) as Array<{
    translation_id: number;
    text: string;
    string_id: number;
    formid_hex: string;
    path: string;
  }>;

  const matches: SearchReplaceMatch[] = [];

  // Validate regex before applying to any row
  let pattern: RegExp | null = null;
  if (isRegex) {
    try {
      pattern = new RegExp(search, 'g');
    } catch {
      throw new Error(`Invalid regular expression: ${search}`);
    }
  }

  for (const row of rows) {
    let newText: string;
    if (isRegex && pattern) {
      pattern.lastIndex = 0; // reset global flag
      newText = row.text.replace(pattern, replace);
    } else {
      newText = row.text.split(search).join(replace);
    }

    if (newText !== row.text) {
      matches.push({
        translationId: row.translation_id,
        stringId: row.string_id,
        formid_hex: row.formid_hex,
        path: row.path,
        originalText: row.text,
        newText,
      });
    }
  }

  if (!dryRun && matches.length > 0) {
    const update = db.prepare(
      `UPDATE translations SET text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    );
    db.transaction(() => {
      for (const m of matches) update.run(m.newText, m.translationId);
    })();
  }

  return { matches, applied: dryRun ? 0 : matches.length };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getModStats(db: Tx, modId: number) {
  return db
    .prepare(
      `SELECT
        COUNT(DISTINCT s.id)          AS total,
        COUNT(DISTINCT t.id)          AS translated,
        COUNT(DISTINCT CASE WHEN t.status='human' THEN t.id END) AS approved,
        COUNT(DISTINCT CASE WHEN t.status='fuzzy'  THEN t.id END) AS fuzzy,
        COUNT(DISTINCT CASE WHEN t.status='auto'   THEN t.id END) AS auto_translated,
        COUNT(DISTINCT CASE WHEN t.id IS NULL       THEN s.id END) AS untranslated
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
       WHERE r.mod_id = ? AND s.lang = 'en'`,
    )
    .get(modId);
}
