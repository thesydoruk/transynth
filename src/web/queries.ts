import type { Tx } from '../db.js';
import { withTransaction } from '../db.js';
import type pg from 'pg';
import { log } from '../logger.js';

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

function extractPlaceholders(text: string): string[] {
  const matches = text.match(/%[A-Za-z0-9_]+%|%[ds]\b|\{[^}]+\}|\$\{[^}]+\}|<[^>]+>/g) ?? [];
  return matches.sort();
}

function buildQAIssues(source: string, translation: string): QAIssueInput[] {
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

  return issues;
}

async function recordTranslationRevision(db: Tx, input: RevisionInput): Promise<void> {
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

async function refreshQAIssues(db: Tx, stringId: number, targetLang: string): Promise<void> {
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

export async function listMods(db: Tx) {
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

export async function getMod(db: Tx, id: number) {
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
};

export async function listStrings(db: Tx, f: StringsFilter) {
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
     ORDER BY r.signature, r.path
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

export async function listSignatures(db: Tx, modId: number, srcLang = 'en') {
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

export async function listModLangs(db: Tx, modId: number): Promise<string[]> {
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

export async function getTMSuggestions(
  db: Tx,
  stringId: number,
  targetLang: string,
  limit = 5,
) {
  // Find strings with similar normalised source text and their translations
  const { rows: srcRows } = await db.query(
    `SELECT text_norm FROM strings WHERE id = $1`,
    [stringId],
  );
  if (!srcRows[0]?.text_norm) return [];

  const { rows } = await db.query(
    `SELECT DISTINCT ON (t.text)
        t.id, t.text, t.status, t.confidence, t.provenance,
        s.text_raw AS source_text
     FROM strings s
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE s.text_norm = $1
       AND s.id <> $3
     ORDER BY t.text, ${BEST_TRANSLATION_ORDER},
       COALESCE(t.confidence, 0) DESC
     LIMIT $4`,
    [srcRows[0].text_norm, targetLang, stringId, limit],
  );
  return rows;
}

// ── Translations ──────────────────────────────────────────────────────────────

export async function upsertTranslation(
  db: Tx,
  stringId: number,
  text: string,
  status: Exclude<TranslationStatus, 'deleted'>,
  targetLang = 'uk',
  provenance?: string,
  model?: string,
) {
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

export async function updateTranslationStatus(db: Tx, translationId: number, status: string) {
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

export async function deleteTranslation(db: Tx, stringId: number, targetLang = 'uk') {
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
export async function getStringTextNorm(db: Tx, stringId: number): Promise<string | null> {
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

export async function diffMods(
  db: Tx,
  newModId: number,
  oldModId: number,
  targetLang = 'uk',
): Promise<{ added: DiffEntry[]; removed: DiffEntry[]; changed: DiffEntry[]; unchanged: number }> {
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

// ── Bulk search-replace ───────────────────────────────────────────────────────

export type SearchReplaceMatch = {
  translationId: number;
  stringId: number;
  formid_hex: string;
  path: string;
  originalText: string;
  newText: string;
};

export async function searchReplaceTranslations(
  db: Tx,
  modId: number,
  search: string,
  replace: string,
  isRegex: boolean,
  targetLang: string,
  dryRun: boolean,
): Promise<{ matches: SearchReplaceMatch[]; applied: number }> {
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

export async function getModStats(db: Tx, modId: number) {
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

export async function getTranslationHistory(db: Tx, stringId: number, targetLang = 'uk') {
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

export async function getQAIssues(db: Tx, stringId: number, targetLang = 'uk') {
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

export async function bulkUpdateTranslationStatus(
  db: Tx,
  modId: number,
  stringIds: number[],
  newStatus: 'reviewed' | 'rejected',
  targetLang = 'uk',
): Promise<number> {
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
