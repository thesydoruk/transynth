import type { Tx } from '../db.js';
import { withTransaction } from '../db.js';
import type pg from 'pg';
import { log } from '../logger.js';
import { normalizeForHash, segmentPhrases } from '../utils/textNorm.js';

export type TranslationStatus = 'draft' | 'reviewed' | 'rejected' | 'human' | 'tm' | 'fuzzy' | 'auto' | 'deleted';

const BEST_TRANSLATION_ORDER = `CASE status
  WHEN 'draft' THEN 1
  WHEN 'reviewed' THEN 2
  WHEN 'human' THEN 3
  WHEN 'tm' THEN 4
  WHEN 'fuzzy' THEN 5
  WHEN 'auto' THEN 6
  WHEN 'rejected' THEN 7
  ELSE 8 END`;

const APPROVED_STATUS_SQL = `('reviewed', 'human')`;

type RevisionInput = {
  stringId: number;
  translationId: number | null;
  targetLang: string;
  text: string | null;
  status: TranslationStatus;
  provenance?: string | null;
  model?: string | null;
  note?: string | null;
};

type QAIssueInput = {
  issueType: string;
  severity: 'warning' | 'error';
  message: string;
};

const extractPlaceholders = (text: string): string[] => {
  const matches = text.match(/%[A-Za-z0-9_]+%|%[ds]\b|\{[^}]+\}|\$\{[^}]+\}|<[^>]+>/g) ?? [];
  return matches.sort();
}

const buildQAIssues = (source: string, translation: string): QAIssueInput[] => {
  const issues: QAIssueInput[] = [];
  const trimmed = translation.trim();

  if (trimmed.length === 0) {
    issues.push({
      issueType: 'empty_translation',
      severity: 'error',
      message: 'Translation is empty.',
    });
    return issues;
  }

  const srcPlaceholders = extractPlaceholders(source);
  const dstPlaceholders = extractPlaceholders(translation);
  if (srcPlaceholders.join('\u0000') !== dstPlaceholders.join('\u0000')) {
    issues.push({
      issueType: 'placeholder_mismatch',
      severity: 'error',
      message: `Placeholder mismatch: source=[${srcPlaceholders.join(', ')}] target=[${dstPlaceholders.join(', ')}]`,
    });
  }

  if (source.trim() === trimmed && source.trim().length > 0) {
    issues.push({
      issueType: 'same_as_source',
      severity: 'warning',
      message: 'Translation is identical to source text.',
    });
  }

  if (source.length >= 20) {
    const ratio = trimmed.length / Math.max(1, source.length);
    if (ratio > 1.6 || ratio < 0.5) {
      issues.push({
        issueType: 'length_delta',
        severity: 'warning',
        message: `Translation length ratio is ${ratio.toFixed(2)} compared to source.`,
      });
    }
  }

  // Forbidden characters: control chars (except \n \r \t), null bytes
  const forbiddenRe = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  const forbidden = translation.match(forbiddenRe);
  if (forbidden) {
    const unique = [...new Set(forbidden)].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    issues.push({
      issueType: 'forbidden_chars',
      severity: 'error',
      message: `Contains forbidden control characters: ${unique.join(', ')}`,
    });
  }

  return issues;
}

const recordTranslationRevision = async (db: Tx, input: RevisionInput): Promise<void> => {
  await db.query(
    `INSERT INTO translation_revisions(
       src_string_id, translation_id, target_lang, text, status, provenance, model, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.stringId,
      input.translationId,
      input.targetLang,
      input.text,
      input.status,
      input.provenance ?? null,
      input.model ?? null,
      input.note ?? null,
    ],
  );
}

const refreshQAIssues = async (db: Tx, stringId: number, targetLang: string): Promise<void> => {
  const { rows } = await db.query(
    `SELECT s.text_raw AS source, t.id AS translation_id, t.text AS translation
     FROM strings s
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $2
       AND t.id = (
         SELECT id FROM translations
         WHERE src_string_id = s.id AND target_lang = $2
         ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence, 0) DESC, updated_at DESC
         LIMIT 1
       )
     WHERE s.id = $1`,
    [stringId, targetLang],
  );

  const row = rows[0] as { source?: string; translation_id?: number | null; translation?: string | null } | undefined;

  await db.query(
    `DELETE FROM qa_issues WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );

  if (!row?.source || row.translation == null) {
    return;
  }

  const issues = buildQAIssues(row.source, row.translation);

  // Glossary violation check: source contains a glossary term but translation is missing the required translation
  const { rows: glossaryTerms } = await db.query(
    `SELECT term, translation FROM glossary
     WHERE src_lang = 'en' AND tgt_lang = $1 AND translation IS NOT NULL`,
    [targetLang],
  );
  const srcLower = row.source.toLowerCase();
  const tgtLower = row.translation.toLowerCase();
  for (const g of glossaryTerms as Array<{ term: string; translation: string }>) {
    if (srcLower.includes(g.term.toLowerCase()) && !tgtLower.includes(g.translation.toLowerCase())) {
      issues.push({
        issueType: 'glossary_violation',
        severity: 'warning',
        message: `Glossary: "${g.term}" should be translated as "${g.translation}".`,
      });
    }
  }

  // Duplicate inconsistency: same source text_norm translated differently elsewhere
  const { rows: inconsistent } = await db.query(
    `SELECT DISTINCT t2.text
     FROM strings s1
     JOIN strings s2 ON s2.text_norm = s1.text_norm AND s2.lang = s1.lang AND s2.id <> s1.id
     JOIN translations t2 ON t2.src_string_id = s2.id AND t2.target_lang = $2
       AND t2.id = (
         SELECT id FROM translations
         WHERE src_string_id = s2.id AND target_lang = $2
         ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence, 0) DESC, updated_at DESC
         LIMIT 1
       )
     WHERE s1.id = $1 AND s1.text_norm IS NOT NULL AND s1.text_norm <> ''
       AND t2.text <> $3
     LIMIT 5`,
    [stringId, targetLang, row.translation],
  );
  if (inconsistent.length > 0) {
    const alts = (inconsistent as Array<{ text: string }>).map((r) => `"${r.text}"`).join(', ');
    issues.push({
      issueType: 'duplicate_inconsistency',
      severity: 'warning',
      message: `Same source text is translated differently elsewhere: ${alts}`,
    });
  }

  for (const issue of issues) {
    await db.query(
      `INSERT INTO qa_issues(
         src_string_id, translation_id, target_lang, issue_type, severity, message, is_active, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
      [stringId, row.translation_id ?? null, targetLang, issue.issueType, issue.severity, issue.message],
    );
  }
}

// ── Mods ─────────────────────────────────────────────────────────────────────

export const listMods = async (db: Tx) => {
  const { rows } = await db.query(
    `SELECT
      m.id,
      m.name,
      m.abs_path,
      m.version_hash,
      m.created_at,
      COUNT(DISTINCT r.id)          AS record_count,
      COUNT(DISTINCT s.id)          AS string_count,
      COUNT(DISTINCT t.id)          AS translated_count,
      COUNT(DISTINCT CASE WHEN t.status IN ${APPROVED_STATUS_SQL} THEN t.id END) AS approved_count,
      COUNT(DISTINCT CASE WHEN t.status='fuzzy'  THEN t.id END) AS fuzzy_count
     FROM mods m
     LEFT JOIN records r ON r.mod_id = m.id
     LEFT JOIN strings s ON s.record_id = r.id AND s.lang = 'en'
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
     GROUP BY m.id
     ORDER BY m.created_at DESC`,
  );
  return rows;
}

export const getMod = async (db: Tx, id: number) => {
  const { rows } = await db.query(`SELECT * FROM mods WHERE id = $1`, [id]);
  return rows[0];
}

// ── Strings ───────────────────────────────────────────────────────────────────

export type StringsFilter = {
  modId: number;
  srcLang?: string;
  targetLang?: string;
  status?: string;
  query?: string;
  signature?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
};

/** Whitelist mapping from client-facing sort key to SQL column expression. */
const SORT_COLUMNS: Record<string, string> = {
  grup: 'r.signature',
  formid: 'r.formid_hex',
  edid: 'r.edid',
  field: 'r.path',
  src: 's.text_raw',
  transl: 't.text',
};

export const listStrings = async (db: Tx, f: StringsFilter) => {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const srcLang = f.srcLang ?? 'en';
  const targetLang = f.targetLang ?? 'uk';

  const conditions: string[] = ['r.mod_id = $1'];
  const values: unknown[] = [f.modId];
  let idx = 2;

  if (f.status && f.status !== 'all') {
    if (f.status === 'untranslated') {
      conditions.push('t.id IS NULL');
    } else {
      conditions.push(`t.status = $${idx}`);
      values.push(f.status);
      idx++;
    }
  }

  if (f.signature) {
    conditions.push(`r.signature = $${idx}`);
    values.push(f.signature);
    idx++;
  }

  if (f.query) {
    conditions.push(`(s.text_raw LIKE $${idx} OR r.formid_hex LIKE $${idx} OR r.edid LIKE $${idx})`);
    values.push(`%${f.query}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  // Append targetLang, srcLang, pageSize, offset as the final parameters
  const targetLangIdx = idx;
  const srcLangIdx = idx + 1;
  const limitIdx = idx + 2;
  const offsetIdx = idx + 3;
  const allValues = [...values, targetLang, srcLang, pageSize, offset];

  const { rows } = await db.query(
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
      t.updated_at,
      COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
          AND t.id = (
            SELECT id FROM translations
            WHERE src_string_id = s.id AND target_lang = $${targetLangIdx}
            ORDER BY ${BEST_TRANSLATION_ORDER},
              COALESCE(confidence,0) DESC, created_at DESC
            LIMIT 1
          )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${targetLangIdx} AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE s.lang = $${srcLangIdx} AND ${where}
     ORDER BY ${SORT_COLUMNS[f.sort ?? ''] ? `${SORT_COLUMNS[f.sort!]} ${f.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST,` : ''} r.signature, r.path
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    allValues,
  );

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS total
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
          AND t.id = (
            SELECT id FROM translations
            WHERE src_string_id = s.id AND target_lang = $${targetLangIdx}
            ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence, 0) DESC, created_at DESC
            LIMIT 1
          )
     WHERE s.lang = $${srcLangIdx} AND ${where}`,
    [...values, targetLang, srcLang],
  );

  return { rows, total: Number(countRows[0].total), page, pageSize };
}

export const listSignatures = async (db: Tx, modId: number, srcLang = 'en') => {
  const { rows } = await db.query(
    `SELECT DISTINCT r.signature, COUNT(*) as count
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     WHERE r.mod_id = $1
     GROUP BY r.signature
     ORDER BY count DESC`,
    [modId, srcLang],
  );
  return rows;
}

export const listModLangs = async (db: Tx, modId: number): Promise<string[]> => {
  // Source langs from strings table + target langs from translations table
  const { rows } = await db.query(
    `SELECT DISTINCT lang FROM (
       SELECT s.lang
       FROM strings s JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = $1
       UNION
       SELECT t.target_lang AS lang
       FROM translations t
       JOIN strings s ON t.src_string_id = s.id
       JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = $1
     ) langs
     ORDER BY lang`,
    [modId],
  );
  return rows.map((r: { lang: string }) => r.lang);
}

export type TMSuggestionRow = {
  id: number;
  text: string;
  status: string;
  confidence: number | null;
  provenance: string | null;
  source_text: string;
  match_method: 'exact' | 'punct_norm' | 'fuzzy' | 'segment';
  similarity: number;
};

export const getTMSuggestions = async (
  db: Tx,
  stringId: number,
  targetLang: string,
  limit = 10,
): Promise<TMSuggestionRow[]> => {
  const { rows: srcRows } = await db.query(
    `SELECT text_norm, text_norm_nopunct FROM strings WHERE id = $1`,
    [stringId],
  );
  if (!srcRows[0]?.text_norm) return [];

  const textNorm: string = srcRows[0].text_norm;
  const textNormNopunct: string | null = srcRows[0].text_norm_nopunct;
  const results: TMSuggestionRow[] = [];
  const seenTexts = new Set<string>();

  const addRows = (rows: any[], method: TMSuggestionRow['match_method'], sim: number) => {
    for (const r of rows) {
      if (seenTexts.has(r.text)) continue;
      seenTexts.add(r.text);
      results.push({ ...r, match_method: method, similarity: r.similarity ?? sim });
    }
  };

  // 1. Exact text_norm match (highest priority)
  const { rows: exactRows } = await db.query(
    `SELECT DISTINCT ON (t.text)
        t.id, t.text, t.status, t.confidence, t.provenance,
        s.text_raw AS source_text, 1.0::double precision AS similarity
     FROM strings s
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE s.text_norm = $1
       AND s.id <> $3
     ORDER BY t.text, ${BEST_TRANSLATION_ORDER},
       COALESCE(t.confidence, 0) DESC
     LIMIT $4`,
    [textNorm, targetLang, stringId, limit],
  );
  addRows(exactRows, 'exact', 1.0);

  // 2. Punctuation-normalized match (if text_norm_nopunct available and we need more)
  if (textNormNopunct && results.length < limit) {
    const { rows: punctRows } = await db.query(
      `SELECT DISTINCT ON (t.text)
          t.id, t.text, t.status, t.confidence, t.provenance,
          s.text_raw AS source_text, 0.9::double precision AS similarity
       FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm_nopunct = $1
         AND s.text_norm <> $5
         AND s.id <> $3
       ORDER BY t.text, ${BEST_TRANSLATION_ORDER},
         COALESCE(t.confidence, 0) DESC
       LIMIT $4`,
      [textNormNopunct, targetLang, stringId, limit - results.length, textNorm],
    );
    addRows(punctRows, 'punct_norm', 0.9);
  }

  // 3. Fuzzy trigram match (pg_trgm) — only if we still need more
  if (results.length < limit && textNorm.length >= 4) {
    const { rows: fuzzyRows } = await db.query(
      `SELECT DISTINCT ON (t.text)
          t.id, t.text, t.status, t.confidence, t.provenance,
          s.text_raw AS source_text,
          similarity(s.text_norm, $1)::double precision AS similarity
       FROM strings s
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm % $1
         AND s.text_norm <> $1
         AND s.id <> $3
       ORDER BY t.text, similarity(s.text_norm, $1) DESC,
         ${BEST_TRANSLATION_ORDER},
         COALESCE(t.confidence, 0) DESC
       LIMIT $4`,
      [textNorm, targetLang, stringId, limit - results.length],
    );
    addRows(fuzzyRows, 'fuzzy', 0);
  }

  // 4. Phrase segment matching — split long text into clauses and look up each
  if (results.length < limit) {
    const { rows: srcTextRows } = await db.query(
      `SELECT text_raw FROM strings WHERE id = $1`,
      [stringId],
    );
    const rawText: string = srcTextRows[0]?.text_raw ?? '';
    const segments = segmentPhrases(rawText);

    for (const seg of segments) {
      if (results.length >= limit) break;
      const segNorm = normalizeForHash(seg);
      if (!segNorm || segNorm.length < 3) continue;

      const { rows: segRows } = await db.query(
        `SELECT DISTINCT ON (t.text)
            t.id, t.text, t.status, t.confidence, t.provenance,
            s.text_raw AS source_text,
            0.5::double precision AS similarity
         FROM strings s
         JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
         WHERE s.text_norm = $1 AND s.id <> $3
         ORDER BY t.text, ${BEST_TRANSLATION_ORDER},
           COALESCE(t.confidence, 0) DESC
         LIMIT 2`,
        [segNorm, targetLang, stringId],
      );
      addRows(segRows, 'segment', 0.5);
    }
  }

  /* ── Final ranking ─────────────────────────────────────────────────────── */
  /* Sort by composite score: method weight × similarity, then by status.   */
  const methodWeight: Record<string, number> = {
    exact: 1.0,
    punct_norm: 0.85,
    fuzzy: 0.7,
    segment: 0.4,
  };
  const statusWeight: Record<string, number> = {
    reviewed: 6, human: 5, tm: 4, fuzzy: 3, auto: 2, draft: 1,
  };
  results.sort((a, b) => {
    const scoreA = (methodWeight[a.match_method] ?? 0.5) * a.similarity;
    const scoreB = (methodWeight[b.match_method] ?? 0.5) * b.similarity;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0);
  });

  return results.slice(0, limit);
}

// ── Translations ──────────────────────────────────────────────────────────────

export const upsertTranslation = async (
  db: Tx,
  stringId: number,
  text: string,
  status: Exclude<TranslationStatus, 'deleted'>,
  targetLang = 'uk',
  provenance?: string,
  model?: string,
) => {
  const effectiveProvenance = provenance ?? (status === 'draft' || status === 'reviewed' || status === 'rejected' || status === 'human'
    ? 'human_edit'
    : `${status}_generated`);

  await db.query(
    `DELETE FROM translations WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );

  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, updated_at)
     VALUES ($1, $2, $3, $4, 1.0, $5, NOW())
     RETURNING id`,
    [stringId, targetLang, text, status, effectiveProvenance],
  );

  const translationId = rows[0].id as number;
  await recordTranslationRevision(db, {
    stringId,
    translationId,
    targetLang,
    text,
    status,
    provenance: effectiveProvenance,
    model: model ?? null,
    note: 'save',
  });
  await refreshQAIssues(db, stringId, targetLang);

  return { id: translationId, text, status };
}

export const updateTranslationStatus = async (db: Tx, translationId: number, status: string) => {
  const { rows } = await db.query(
    `UPDATE translations
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, src_string_id, target_lang, text, status, provenance, model`,
    [status, translationId],
  );

  const updated = rows[0] as {
    id: number;
    src_string_id: number;
    target_lang: string;
    text: string;
    status: TranslationStatus;
    provenance: string | null;
    model: string | null;
  } | undefined;

  if (!updated) return;

  await recordTranslationRevision(db, {
    stringId: updated.src_string_id,
    translationId: updated.id,
    targetLang: updated.target_lang,
    text: updated.text,
    status: updated.status,
    provenance: updated.provenance,
    model: updated.model,
    note: 'status_change',
  });
  await refreshQAIssues(db, updated.src_string_id, updated.target_lang);
}

export const deleteTranslation = async (db: Tx, stringId: number, targetLang = 'uk') => {
  const { rows } = await db.query(
    `DELETE FROM translations
     WHERE src_string_id = $1 AND target_lang = $2
     RETURNING id, text, provenance, model`,
    [stringId, targetLang],
  );

  for (const row of rows as Array<{ id: number; text: string; provenance: string | null; model: string | null }>) {
    await recordTranslationRevision(db, {
      stringId,
      translationId: row.id,
      targetLang,
      text: row.text,
      status: 'deleted',
      provenance: row.provenance,
      model: row.model,
      note: 'clear',
    });
  }

  await db.query(
    `DELETE FROM qa_issues WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );

  return { removed: rows.length };
}

// Returns text_norm for a string ID (used by propagation)
export const getStringTextNorm = async (db: Tx, stringId: number): Promise<string | null> => {
  const { rows } = await db.query(`SELECT text_norm FROM strings WHERE id = $1`, [stringId]);
  return rows[0]?.text_norm ?? null;
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

export const diffMods = async (
  db: Tx,
  newModId: number,
  oldModId: number,
  targetLang = 'uk',
): Promise<{ added: DiffEntry[]; removed: DiffEntry[]; changed: DiffEntry[]; unchanged: number }> => {
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
       WHERE r.mod_id = $2 AND s.lang = 'en'`,
      [targetLang, modId],
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
}

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
  targetLang = 'uk',
): Promise<{ carried: number; needsReview: number; skipped: number }> => {
  // Step 1: Fetch all strings in the new mod with their normalized source text
  const { rows: newStrings } = await db.query(
    `SELECT s.id AS string_id, r.formid_hex, r.path, s.text_norm
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = 'en'`,
    [newModId],
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
     WHERE r.mod_id = $1 AND s.lang = 'en'`,
    [oldModId, targetLang],
  );

  // Build lookup map: identity key → old translation data
  type OldEntry = { text_norm: string; translation: string; status: string; provenance: string | null; model: string | null };
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

  for (const row of newStrings as Array<{ string_id: number; formid_hex: string; path: string; text_norm: string }>) {
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

  log.info(`Carry-over: ${carried} carried, ${needsReview} need review, ${skipped} skipped (already translated)`);
  return { carried, needsReview, skipped };
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

export const searchReplaceTranslations = async (
  db: Tx,
  modId: number,
  search: string,
  replace: string,
  isRegex: boolean,
  targetLang: string,
  dryRun: boolean,
): Promise<{ matches: SearchReplaceMatch[]; applied: number }> => {
  const { rows } = await db.query(
    `SELECT t.id AS translation_id, t.text, t.src_string_id AS string_id,
            r.formid_hex, r.path
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id AND s.lang = 'en'
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND t.target_lang = $2`,
    [modId, targetLang],
  );

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
      pattern.lastIndex = 0;
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
    log.info(`search-replace: applying ${matches.length} changes`);
    await withTransaction(db as pg.Pool, async (client) => {
      for (const m of matches) {
        await client.query(
          `UPDATE translations SET text = $1, updated_at = NOW() WHERE id = $2`,
          [m.newText, m.translationId],
        );
        const { rows: updatedRows } = await client.query(
          `SELECT src_string_id, target_lang, status, provenance, model
           FROM translations WHERE id = $1`,
          [m.translationId],
        );
        const updated = updatedRows[0] as {
          src_string_id: number;
          target_lang: string;
          status: TranslationStatus;
          provenance: string | null;
          model: string | null;
        } | undefined;
        if (!updated) continue;
        await recordTranslationRevision(client, {
          stringId: updated.src_string_id,
          translationId: m.translationId,
          targetLang: updated.target_lang,
          text: m.newText,
          status: updated.status,
          provenance: updated.provenance,
          model: updated.model,
          note: 'search_replace',
        });
        await refreshQAIssues(client, updated.src_string_id, updated.target_lang);
      }
    });
  }

  return { matches, applied: dryRun ? 0 : matches.length };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export const getModStats = async (db: Tx, modId: number) => {
  const { rows } = await db.query(
    `SELECT
      COUNT(DISTINCT s.id)          AS total,
      COUNT(DISTINCT t.id)          AS translated,
      COUNT(DISTINCT CASE WHEN t.status IN ${APPROVED_STATUS_SQL} THEN t.id END) AS approved,
      COUNT(DISTINCT CASE WHEN t.status='draft'  THEN t.id END) AS draft,
      COUNT(DISTINCT CASE WHEN t.status='rejected' THEN t.id END) AS rejected,
      COUNT(DISTINCT CASE WHEN t.status='tm'     THEN t.id END) AS tm,
      COUNT(DISTINCT CASE WHEN t.status='fuzzy'  THEN t.id END) AS fuzzy,
      COUNT(DISTINCT CASE WHEN t.status='auto'   THEN t.id END) AS auto_translated,
      COUNT(DISTINCT CASE WHEN t.id IS NULL       THEN s.id END) AS untranslated
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
     WHERE r.mod_id = $1 AND s.lang = 'en'`,
    [modId],
  );
  return rows[0];
}

export const getTranslationHistory = async (db: Tx, stringId: number, targetLang = 'uk') => {
  const { rows } = await db.query(
    `SELECT id, translation_id, text, status, provenance, model, note, created_at
     FROM translation_revisions
     WHERE src_string_id = $1 AND target_lang = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 25`,
    [stringId, targetLang],
  );
  return rows;
}

export const getQAIssues = async (db: Tx, stringId: number, targetLang = 'uk') => {
  const { rows } = await db.query(
    `SELECT id, issue_type, severity, message, updated_at
     FROM qa_issues
     WHERE src_string_id = $1 AND target_lang = $2 AND is_active = TRUE
     ORDER BY CASE severity WHEN 'error' THEN 1 ELSE 2 END, updated_at DESC, id DESC`,
    [stringId, targetLang],
  );
  return rows;
}

// ── Bulk status update ────────────────────────────────────────────────────────

export const bulkUpdateTranslationStatus = async (
  db: Tx,
  modId: number,
  stringIds: number[],
  newStatus: 'reviewed' | 'rejected',
  targetLang = 'uk',
): Promise<number> => {
  if (stringIds.length === 0) return 0;

  let updated = 0;
  await withTransaction(db as pg.Pool, async (client) => {
    // Fetch the best translation for each requested stringId in one query
    const placeholders = stringIds.map((_, i) => `$${i + 3}`).join(',');
    const { rows } = await client.query(
      `SELECT DISTINCT ON (t.src_string_id)
              t.id AS translation_id, t.src_string_id AS string_id, t.target_lang
       FROM translations t
       JOIN strings s ON s.id = t.src_string_id
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1
         AND t.target_lang = $2
         AND t.src_string_id IN (${placeholders})
       ORDER BY t.src_string_id, ${BEST_TRANSLATION_ORDER}`,
      [modId, targetLang, ...stringIds],
    );

    for (const row of rows as Array<{ translation_id: number; string_id: number; target_lang: string }>) {
      await updateTranslationStatus(client, row.translation_id, newStatus);
      updated++;
    }
  });

  return updated;
}
