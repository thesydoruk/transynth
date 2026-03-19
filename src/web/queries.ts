import type { Tx } from '../db.js';
import { withTransaction } from '../db.js';
import type pg from 'pg';
import { log } from '../logger.js';
import { CONFIG } from '../config.js';
import { normalizeForHash, segmentPhrases, extractNumbers, transplantNumbers } from '../utils/textNorm.js';
import { assertTransition, isValidTranslationStatus } from './statusMachine.js';
import type { TranslationStatus, StatusActor } from './statusMachine.js';

// Re-export so existing callers that import TranslationStatus from queries.ts
// continue to work without changes.
export type { TranslationStatus } from './statusMachine.js';

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

/**
 * Escape special regex metacharacters in a string so it can be used
 * inside a `new RegExp(...)` as a literal match.
 */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a case-insensitive word-boundary regex for an English glossary term.
 * Uses `\b` anchors so that "iron" won't match inside "environment".
 *
 * @param term - The English glossary term to match.
 * @returns A RegExp that matches the term at word boundaries, case-insensitively.
 */
export const termWordBoundaryRe = (term: string): RegExp =>
  new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');

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

const refreshQAIssues = async (db: Tx, stringId: number, targetLang: string, srcLang = CONFIG.defaultSrcLang): Promise<void> => {
  // Fetch source text, best translation, and record context (signature + path + game) for rule matching
  const { rows } = await db.query(
    `SELECT s.text_raw AS source, t.id AS translation_id, t.text AS translation,
            r.signature, r.path, m.game
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
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

  const row = rows[0] as { source?: string; translation_id?: number | null; translation?: string | null; signature?: string | null; path?: string | null; game?: string } | undefined;

  await db.query(
    `DELETE FROM qa_issues WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );

  if (!row?.source || row.translation == null) {
    return;
  }

  const issues = buildQAIssues(row.source, row.translation);

  // ── Configurable QA rules (forbidden_chars / max_length per GRUP·field) ───
  // FO76 shares the same record format as FO4, so QA rules configured for
  // 'fo4' also apply to 'fo76' strings.
  const ruleGame = row.game === 'fo76' ? 'fo4' : (row.game ?? 'fo4');
  const { rows: qaRules } = await db.query(
    `SELECT rule_type, value, severity, description, signature AS rule_sig, path AS rule_path
     FROM qa_rules
     WHERE game = $1 AND is_active = TRUE`,
    [ruleGame],
  );

  for (const rule of qaRules as Array<{ rule_type: string; value: string; severity: string; description: string | null; rule_sig: string | null; rule_path: string | null }>) {
    // Skip rule if its signature filter doesn't match this record
    if (rule.rule_sig && rule.rule_sig !== row.signature) continue;
    // Skip rule if its path filter doesn't match this record
    if (rule.rule_path && rule.rule_path !== row.path) continue;

    if (rule.rule_type === 'forbidden_chars') {
      // Check if translation contains any of the forbidden characters listed in rule.value
      const found: string[] = [];
      for (const ch of rule.value) {
        if (row.translation.includes(ch)) found.push(ch);
      }
      if (found.length > 0) {
        const display = found.map((c) => {
          const cp = c.codePointAt(0)!;
          // Show printable chars as-is, non-printable as U+XXXX
          return cp >= 0x20 && cp < 0x7F ? `"${c}"` : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
        });
        issues.push({
          issueType: 'forbidden_chars',
          severity: rule.severity as 'warning' | 'error',
          message: rule.description ?? `Forbidden characters found: ${display.join(', ')}`,
        });
      }
    } else if (rule.rule_type === 'max_length') {
      // Check if translation exceeds the maximum character length
      const maxLen = parseInt(rule.value, 10);
      if (!Number.isNaN(maxLen) && row.translation.length > maxLen) {
        issues.push({
          issueType: 'max_length',
          severity: rule.severity as 'warning' | 'error',
          message: rule.description ?? `Translation is ${row.translation.length} chars, exceeds max ${maxLen}.`,
        });
      }
    }
  }

  // ── Glossary violation check ────────────────────────────────────────────
  // Source matching uses \b word boundaries so that e.g. "iron" won't match
  // inside "environment". Target matching uses a plain case-insensitive
  // substring check because Cyrillic word forms may be inflected.
  const { rows: glossaryTerms } = await db.query(
    `SELECT term, translation FROM glossary
     WHERE src_lang = $1 AND tgt_lang = $2 AND translation IS NOT NULL`,
    [srcLang, targetLang],
  );
  const tgtLower = row.translation.toLowerCase();
  for (const g of glossaryTerms as Array<{ term: string; translation: string }>) {
    if (termWordBoundaryRe(g.term).test(row.source) && !tgtLower.includes(g.translation.toLowerCase())) {
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

/**
 * List mods with aggregate translation statistics.
 * @param db        - database connection / transaction
 * @param opts.game       - optional game filter (e.g. 'fo4'); when omitted returns all games
 * @param opts.srcLang    - source language for string counts
 * @param opts.targetLang - target language for translation counts
 */
export const listMods = async (
  db: Tx,
  opts: { game?: string; srcLang?: string; targetLang?: string } = {},
) => {
  const srcLang    = opts.srcLang    ?? CONFIG.defaultSrcLang;
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  /* Build an optional WHERE clause when a game filter is provided. */
  const whereClause = opts.game ? 'WHERE m.game = $3' : '';
  const params: unknown[] = [srcLang, targetLang];
  if (opts.game) params.push(opts.game);

  const { rows } = await db.query(
    `SELECT
      m.id,
      m.name,
      m.abs_path,
      m.version_hash,
      m.game,
      m.nexus_mod_id,
      m.nexus_name,
      m.nexus_thumbnail,
      m.created_at,
      COUNT(DISTINCT r.id)          AS record_count,
      COUNT(DISTINCT s.id)          AS string_count,
      COUNT(DISTINCT t.id)          AS translated_count,
      COUNT(DISTINCT CASE WHEN t.status IN ${APPROVED_STATUS_SQL} THEN t.id END) AS approved_count,
      COUNT(DISTINCT CASE WHEN t.status='fuzzy'  THEN t.id END) AS fuzzy_count
     FROM mods m
     LEFT JOIN records r ON r.mod_id = m.id
     LEFT JOIN strings s ON s.record_id = r.id AND s.lang = $1
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     ${whereClause}
     GROUP BY m.id
     ORDER BY m.created_at DESC`,
    params,
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
  /** When true, return only rows that currently have active QA issues. */
  qaOnly?: boolean;
  query?: string;
  signature?: string;
  /** Per-column filter: record signature (GRUP) — case-insensitive substring match */
  grup?: string;
  /** Per-column filter: formid_hex — case-insensitive substring match */
  formid?: string;
  /** Per-column filter: edid — case-insensitive substring match */
  edid?: string;
  /** Per-column filter: path (FIELD) — case-insensitive substring match */
  field?: string;
  /** Per-column filter: source text — case-insensitive substring match */
  src?: string;
  /** Per-column filter: translation text — case-insensitive substring match */
  transl?: string;
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
  /** Sort by translation confidence (ascending = least confident first for review queue). */
  confidence: 't.confidence',
};

export const listStrings = async (db: Tx, f: StringsFilter) => {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const srcLang = f.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = f.targetLang ?? CONFIG.defaultTgtLang;

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

  /* Per-column filters (filter row) */
  if (f.grup) {
    conditions.push(`r.signature ILIKE $${idx}`);
    values.push(`%${f.grup}%`);
    idx++;
  }
  if (f.formid) {
    conditions.push(`r.formid_hex ILIKE $${idx}`);
    values.push(`%${f.formid}%`);
    idx++;
  }
  if (f.edid) {
    conditions.push(`r.edid ILIKE $${idx}`);
    values.push(`%${f.edid}%`);
    idx++;
  }
  if (f.field) {
    conditions.push(`r.path ILIKE $${idx}`);
    values.push(`%${f.field}%`);
    idx++;
  }
  if (f.src) {
    conditions.push(`s.text_raw ILIKE $${idx}`);
    values.push(`%${f.src}%`);
    idx++;
  }
  if (f.transl) {
    conditions.push(`t.text ILIKE $${idx}`);
    values.push(`%${f.transl}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  // Append targetLang, srcLang, pageSize, offset as the final parameters
  const targetLangIdx = idx;
  const srcLangIdx = idx + 1;
  const limitIdx = idx + 2;
  const offsetIdx = idx + 3;
  const qaOnlyIdx = idx + 4;
  const allValues = [...values, targetLang, srcLang, pageSize, offset, Boolean(f.qaOnly)];

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
       AND ($${qaOnlyIdx}::boolean = FALSE OR COALESCE(q.issue_count, 0) > 0)
     ORDER BY ${SORT_COLUMNS[f.sort ?? ''] ? `${SORT_COLUMNS[f.sort!]} ${f.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST,` : ''} r.signature, r.path
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    allValues,
  );

  const countTargetLangIdx = idx;
  const countSrcLangIdx = idx + 1;
  const countQaOnlyIdx = idx + 2;
  const countValues = [...values, targetLang, srcLang, Boolean(f.qaOnly)];

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS total
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
          AND t.id = (
            SELECT id FROM translations
            WHERE src_string_id = s.id AND target_lang = $${countTargetLangIdx}
            ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence, 0) DESC, created_at DESC
            LIMIT 1
          )
     WHERE s.lang = $${countSrcLangIdx} AND ${where}
       AND ($${countQaOnlyIdx}::boolean = FALSE OR EXISTS (
         SELECT 1
         FROM qa_issues qi
         WHERE qi.src_string_id = s.id
           AND qi.target_lang = $${countTargetLangIdx}
           AND qi.is_active = TRUE
       ))`,
    countValues,
  );

  return { rows, total: Number(countRows[0].total), page, pageSize };
}

export const listSignatures = async (db: Tx, modId: number, srcLang = CONFIG.defaultSrcLang) => {
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
  match_method: 'exact' | 'numeric' | 'punct_norm' | 'fuzzy' | 'segment';
  similarity: number;
};

export const getTMSuggestions = async (
  db: Tx,
  stringId: number,
  targetLang: string,
  limit = 10,
): Promise<TMSuggestionRow[]> => {
  const { rows: srcRows } = await db.query(
    `SELECT text_raw, text_norm, text_norm_nopunct FROM strings WHERE id = $1`,
    [stringId],
  );
  if (!srcRows[0]?.text_norm) return [];

  const textRaw: string = srcRows[0].text_raw;
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

  // 1. Exact text_norm match — split into true exact vs numeric transplant
  const { rows: normRows } = await db.query(
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
  /* Separate true exact matches (identical raw text) from numeric matches. */
  const exactRows: typeof normRows = [];
  const numericRows: typeof normRows = [];
  for (const r of normRows) {
    if (r.source_text === textRaw) {
      exactRows.push(r);
    } else {
      /* Try transplanting numbers from the new source into the translation. */
      const oldNums = extractNumbers(r.source_text);
      const newNums = extractNumbers(textRaw);
      const transplanted = transplantNumbers(r.text, oldNums, newNums);
      if (transplanted !== null) {
        numericRows.push({ ...r, text: transplanted, similarity: 0.95 });
      } else {
        /* Transplant failed — still show as exact match with original text. */
        exactRows.push(r);
      }
    }
  }
  addRows(exactRows, 'exact', 1.0);
  addRows(numericRows, 'numeric', 0.95);

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
    numeric: 0.92,
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
  targetLang = CONFIG.defaultTgtLang,
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

export const updateTranslationStatus = async (
  db: Tx,
  translationId: number,
  status: string,
  /** Who is requesting the change. Defaults to 'system' for backward-compat with
   *  internal callers (TM engine, import pipelines) that don't supply an actor. */
  actor: StatusActor = 'system',
) => {
  // Validate the requested status value at the API boundary.
  if (!isValidTranslationStatus(status)) {
    throw Object.assign(new Error(`Invalid status value: '${status}'`), { statusCode: 400 });
  }

  // Fetch the current status so the state machine can enforce allowed transitions.
  const { rows: current } = await db.query<{ status: TranslationStatus }>(
    `SELECT status FROM translations WHERE id = $1`,
    [translationId],
  );
  const currentStatus = current[0]?.status ?? null;

  // Throws with statusCode 403 when the transition is illegal for this actor.
  assertTransition(currentStatus, status, actor);

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

export const deleteTranslation = async (db: Tx, stringId: number, targetLang = CONFIG.defaultTgtLang) => {
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
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
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

/**
 * Applies imported strings from one mod as translations for another mod.
 *
 * Unlike {@link carryOverTranslations}, this flow does not expect the source
 * mod to already have entries in the `translations` table. Instead, it uses
 * raw strings from `fromImportedModId` (for `importedLang`) and writes them
 * as translations into `targetModId` (for `targetLang`) by running a
 * strict-to-loose record matching cascade:
 * 1) `formid + path`
 * 2) `formid + signature + path_simplified`
 * 3) `edid + signature + path_simplified`
 * 4) `edid + path`
 * 5) `edid + signature`
 * 6) `formid + signature`
 * 7) `formid` only
 *
 * Each key layer is ambiguity-safe: if a key points to multiple different
 * imported texts, that key is ignored for auto-apply.
 *
 * Typical usage: import a RU translation mod as a standalone mod, then apply
 * its RU strings to an EN base mod as RU translations.
 */
export const applyImportedModStringsAsTranslations = async (
  db: Tx,
  targetModId: number,
  fromImportedModId: number,
  importedLang: string,
  targetLang = importedLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ applied: number; skipped: number; unmatched: number; empty: number }> => {
  const { rows: importedRows } = await db.query(
    `SELECT r.formid_hex,
            r.path,
            r.path_simplified,
            r.signature,
            r.edid,
            s.text_raw
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $2`,
    [fromImportedModId, importedLang],
  );

  if (importedRows.length === 0) {
    throw new Error(`Imported mod has no strings for lang "${importedLang}"`);
  }

  return applyImportedRowsAsTranslations(
    db,
    targetModId,
    importedRows as Array<{
      formid_hex: string;
      path: string;
      path_simplified: string | null;
      signature: string | null;
      edid: string | null;
      text_raw: string;
    }>,
    importedLang,
    targetLang,
    srcLang,
    `imported_mod_${fromImportedModId}_${importedLang}`,
    `Imported apply: targetMod=${targetModId}, importedMod=${fromImportedModId}`,
  );
};

/**
 * Apply imported translation rows to a target mod without requiring the
 * imported source to exist as a real mod in the database.
 *
 * This powers the direct "apply to existing mod" flow for temporary import
 * jobs. The matching algorithm is the same as the DB-backed imported-mod
 * variant; only the source of imported rows changes.
 */
export const applyImportedRowsAsTranslations = async (
  db: Tx,
  targetModId: number,
  importedRows: Array<{
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    text_raw: string;
  }>,
  importedLang: string,
  targetLang = importedLang,
  srcLang = CONFIG.defaultSrcLang,
  provenance = `imported_rows_${importedLang}`,
  logLabel = `Imported apply: targetMod=${targetModId}`,
  onProgress?: (processed: number, total: number) => void | Promise<void>,
): Promise<{ applied: number; skipped: number; unmatched: number; empty: number }> => {
  /**
   * Normalize record paths so equivalent notations compare reliably.
   * Example: "INFO\\FULL" and "info/full" become the same lookup key.
   */
  const normalizePath = (value: string | null | undefined): string => (value ?? '')
    .trim()
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();

  /**
   * Normalize FormID as uppercase stable identity text.
   */
  const normalizeFormId = (value: string | null | undefined): string => (value ?? '')
    .trim()
    .toUpperCase();

  /**
   * Normalize EDID to case-insensitive match key.
   */
  const normalizeEdid = (value: string | null | undefined): string => (value ?? '')
    .trim()
    .toLowerCase();

  /**
   * Keep only unambiguous candidates in a key map.
   * If two different translations map to the same key, the key is marked as
   * ambiguous (`null`) and is no longer used for automatic application.
   */
  const putUnique = (map: Map<string, string | null>, key: string, text: string): void => {
    if (!key) return;
    const existing = map.get(key);
    if (existing == null && !map.has(key)) {
      map.set(key, text);
      return;
    }
    if (existing !== text) {
      map.set(key, null);
    }
  };

  /**
   * Read a candidate from a map only when it is unique and non-empty.
   */
  const getUnique = (map: Map<string, string | null>, key: string): string | null => {
    const value = map.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  };

  // Step 1: Load target mod source strings that should receive translations.
  const { rows: targetRows } = await db.query(
    `SELECT s.id AS string_id,
            r.formid_hex,
            r.path,
            r.path_simplified,
            r.signature,
            r.edid,
            ROW_NUMBER() OVER (
              PARTITION BY r.formid_hex, r.path
              ORDER BY s.id
            )::int AS identity_rank
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $2`,
    [targetModId, srcLang],
  );

  if (targetRows.length === 0) {
    throw new Error(`Target mod has no source strings for lang "${srcLang}"`);
  }

  // Build lookup maps for an EET4-style cascade: strict identity first,
  // then progressively looser keys (EDID and fallback identity variants).
  const byIdentity = new Map<string, string | null>();
  const byFormIdSignaturePath = new Map<string, string | null>();
  const byFormIdSignature = new Map<string, string | null>();
  const byEdidSignaturePath = new Map<string, string | null>();
  const byEdidPath = new Map<string, string | null>();
  const byEdidSignature = new Map<string, string | null>();
  const byFormIdOnly = new Map<string, string | null>();

  // Buckets preserve ordered duplicates for rank-based fallback.
  const identityBuckets = new Map<string, string[]>();

  for (const row of importedRows as Array<{
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    text_raw: string;
  }>) {
    const translated = (row.text_raw ?? '').trim();
    if (!translated) continue;

    const formId = normalizeFormId(row.formid_hex);
    const pathRaw = normalizePath(row.path);
    const pathSimplified = normalizePath(row.path_simplified) || pathRaw;
    const signature = (row.signature ?? '').trim().toUpperCase();
    const edid = normalizeEdid(row.edid);
    const identityKey = `${formId}|${pathRaw}`;

    putUnique(byIdentity, identityKey, translated);
    if (!identityBuckets.has(identityKey)) identityBuckets.set(identityKey, []);
    identityBuckets.get(identityKey)!.push(translated);

    if (signature) {
      putUnique(byFormIdSignaturePath, `${formId}|${signature}|${pathSimplified}`, translated);
      putUnique(byFormIdSignature, `${formId}|${signature}`, translated);
    }
    if (edid) {
      putUnique(byEdidPath, `${edid}|${pathRaw}`, translated);
      if (signature) {
        putUnique(byEdidSignaturePath, `${edid}|${signature}|${pathSimplified}`, translated);
        putUnique(byEdidSignature, `${edid}|${signature}`, translated);
      }
    }
    putUnique(byFormIdOnly, formId, translated);
  }

  // Step 3: Skip target strings that already have translation in targetLang.
  const targetStringIds = (targetRows as Array<{ string_id: number }>).map((r) => r.string_id);
  const alreadyTranslated = new Set<number>();
  if (targetStringIds.length > 0) {
    const { rows: existing } = await db.query(
      `SELECT DISTINCT src_string_id
       FROM translations
       WHERE src_string_id = ANY($1) AND target_lang = $2`,
      [targetStringIds, targetLang],
    );
    for (const row of existing as Array<{ src_string_id: number }>) {
      alreadyTranslated.add(row.src_string_id);
    }
  }

  // Step 4: Upsert translations by identity match inside one transaction.
  let applied = 0;
  let skipped = 0;
  let unmatched = 0;
  let empty = 0;
  let processed = 0;
  const matchCounters: Record<string, number> = {
    identity: 0,
    identity_ranked: 0,
    formid_signature_path: 0,
    edid_signature_path: 0,
    edid_path: 0,
    edid_signature: 0,
    formid_signature: 0,
    formid_only: 0,
  };

  /**
   * Resolve a translation candidate for a target row using a strict-to-loose
   * matching cascade inspired by EET4 behavior.
   */
  const resolveImportedCandidate = (row: {
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    identity_rank: number;
  }): { text: string; method: keyof typeof matchCounters } | null => {
    const formId = normalizeFormId(row.formid_hex);
    const pathRaw = normalizePath(row.path);
    const pathSimplified = normalizePath(row.path_simplified) || pathRaw;
    const signature = (row.signature ?? '').trim().toUpperCase();
    const edid = normalizeEdid(row.edid);
    const identityKey = `${formId}|${pathRaw}`;

    const directChecks: Array<{ method: keyof typeof matchCounters; key: string; map: Map<string, string | null> }> = [
      { method: 'identity', key: identityKey, map: byIdentity },
      {
        method: 'formid_signature_path',
        key: signature ? `${formId}|${signature}|${pathSimplified}` : '',
        map: byFormIdSignaturePath,
      },
      {
        method: 'edid_signature_path',
        key: edid && signature ? `${edid}|${signature}|${pathSimplified}` : '',
        map: byEdidSignaturePath,
      },
      {
        method: 'edid_path',
        key: edid ? `${edid}|${pathRaw}` : '',
        map: byEdidPath,
      },
      {
        method: 'edid_signature',
        key: edid && signature ? `${edid}|${signature}` : '',
        map: byEdidSignature,
      },
      {
        method: 'formid_signature',
        key: signature ? `${formId}|${signature}` : '',
        map: byFormIdSignature,
      },
      { method: 'formid_only', key: formId, map: byFormIdOnly },
    ];

    for (const check of directChecks) {
      if (!check.key) continue;
      const text = getUnique(check.map, check.key);
      if (text != null) {
        return { text, method: check.method };
      }
    }

    // EET4-like fallback for duplicate keys: when identity is ambiguous,
    // align by row rank within the same FormID+path bucket.
    const bucket = identityBuckets.get(identityKey);
    if (bucket && row.identity_rank > 0 && row.identity_rank <= bucket.length) {
      const ranked = bucket[row.identity_rank - 1]?.trim();
      if (ranked) {
        return { text: ranked, method: 'identity_ranked' };
      }
    }

    return null;
  };

  await withTransaction(db as pg.Pool, async (client) => {
    for (const row of targetRows as Array<{
      string_id: number;
      formid_hex: string;
      path: string;
      path_simplified: string | null;
      signature: string | null;
      edid: string | null;
      identity_rank: number;
    }>) {
      if (alreadyTranslated.has(row.string_id)) {
        skipped += 1;
        processed += 1;
        if (onProgress && (processed % 200 === 0 || processed === targetRows.length)) {
          await onProgress(processed, targetRows.length);
        }
        continue;
      }

      const candidate = resolveImportedCandidate(row);
      if (candidate == null) {
        unmatched += 1;
        processed += 1;
        if (onProgress && (processed % 200 === 0 || processed === targetRows.length)) {
          await onProgress(processed, targetRows.length);
        }
        continue;
      }

      const text = candidate.text.trim();
      if (!text) {
        empty += 1;
        processed += 1;
        if (onProgress && (processed % 200 === 0 || processed === targetRows.length)) {
          await onProgress(processed, targetRows.length);
        }
        continue;
      }

      matchCounters[candidate.method] += 1;

      await upsertTranslation(
        client,
        row.string_id,
        text,
        'draft',
        targetLang,
        provenance,
      );
      applied += 1;
      processed += 1;
      if (onProgress && (processed % 200 === 0 || processed === targetRows.length)) {
        await onProgress(processed, targetRows.length);
      }
    }
  });

  if (onProgress && processed !== targetRows.length) {
    await onProgress(targetRows.length, targetRows.length);
  }

  log.info(
    `${logLabel}, srcLang=${srcLang}, importedLang=${importedLang}, targetLang=${targetLang}, `
    + `applied=${applied}, skipped=${skipped}, unmatched=${unmatched}, empty=${empty}, `
    + `methods=${JSON.stringify(matchCounters)}`,
  );

  return { applied, skipped, unmatched, empty };
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
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ matches: SearchReplaceMatch[]; applied: number }> => {
  const { rows } = await db.query(
    `SELECT t.id AS translation_id, t.text, t.src_string_id AS string_id,
            r.formid_hex, r.path
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id AND s.lang = $3
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND t.target_lang = $2`,
    [modId, targetLang, srcLang],
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

export const getModStats = async (db: Tx, modId: number, srcLang = CONFIG.defaultSrcLang, targetLang = CONFIG.defaultTgtLang) => {
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
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1 AND s.lang = $3`,
    [modId, targetLang, srcLang],
  );
  return rows[0];
}

/**
 * Returns translation progress broken down by record signature (GRUP type) for the
 * specified mod. Each row represents one record type (e.g. DIAL, INFO, NPC_) with
 * per-status string counts — used by the Dashboard GRUP breakdown panel.
 *
 * @param db         - Database connection / transaction
 * @param modId      - ID of the mod to aggregate
 * @param targetLang - Target translation language (default 'uk')
 */
export const getModStatsByGrup = async (
  db: Tx,
  modId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<Array<{
  signature: string;
  total: number;
  translated: number;
  approved: number;
  draft: number;
  tm: number;
  auto: number;
}>> => {
  const { rows } = await db.query(
    `SELECT
       r.signature,
       COUNT(DISTINCT s.id)::int                                                        AS total,
       COUNT(DISTINCT t.id)::int                                                        AS translated,
       COUNT(DISTINCT CASE WHEN t.status IN ('human','reviewed') THEN t.id END)::int   AS approved,
       COUNT(DISTINCT CASE WHEN t.status = 'draft'               THEN t.id END)::int   AS draft,
       COUNT(DISTINCT CASE WHEN t.status IN ('tm','fuzzy')        THEN t.id END)::int   AS tm,
       COUNT(DISTINCT CASE WHEN t.status IN ('auto','auto_translated') THEN t.id END)::int AS auto
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $3
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1
     GROUP BY r.signature
     ORDER BY total DESC, r.signature`,
    [modId, targetLang, srcLang],
  );
  return rows;
};

export const getTranslationHistory = async (db: Tx, stringId: number, targetLang = CONFIG.defaultTgtLang) => {
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

export const getQAIssues = async (db: Tx, stringId: number, targetLang = CONFIG.defaultTgtLang) => {
  const { rows } = await db.query(
    `SELECT id, issue_type, severity, message, updated_at
     FROM qa_issues
     WHERE src_string_id = $1 AND target_lang = $2 AND is_active = TRUE
     ORDER BY CASE severity WHEN 'error' THEN 1 ELSE 2 END, updated_at DESC, id DESC`,
    [stringId, targetLang],
  );
  return rows;
}

// ── Batch glossary enforcement ───────────────────────────────────────────────

/**
 * Batch-enforce glossary terms across all translated strings in scope.
 *
 * 1. Deletes every existing `glossary_violation` QA issue in the target scope.
 * 2. Fetches **all** translated strings (optionally restricted to one mod).
 * 3. For each string, checks whether every glossary term that appears in the
 *    English source (matched with `\b` word boundaries) has its required
 *    translation present in the target text (case-insensitive substring).
 * 4. Creates new `glossary_violation` QA issues for any mismatches found.
 *
 * @param db          - Database transaction handle.
 * @param opts.modId  - Optional: restrict enforcement to strings belonging to this mod.
 * @param opts.targetLang - Target language to check (default `'uk'`).
 * @returns `{ checked, violations }` — how many strings were examined and how
 *          many individual glossary-violation issues were created.
 */
export const enforceGlossary = async (
  db: Tx,
  opts: { modId?: number; targetLang?: string; srcLang?: string } = {},
): Promise<{ checked: number; violations: number }> => {
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  /* ── 1. Load glossary terms (srcLang → targetLang) ───────────────────────── */
  const { rows: glossaryTerms } = await db.query(
    `SELECT term, translation FROM glossary
     WHERE src_lang = $1 AND tgt_lang = $2 AND translation IS NOT NULL`,
    [opts.srcLang ?? CONFIG.defaultSrcLang, targetLang],
  );
  if (glossaryTerms.length === 0) return { checked: 0, violations: 0 };

  /* ── 2. Delete existing glossary_violation issues in scope ──────────── */
  if (opts.modId) {
    await db.query(
      `DELETE FROM qa_issues
       WHERE issue_type = 'glossary_violation' AND target_lang = $1
         AND src_string_id IN (
           SELECT s.id FROM strings s
           JOIN records r ON r.id = s.record_id
           WHERE r.mod_id = $2
         )`,
      [targetLang, opts.modId],
    );
  } else {
    await db.query(
      `DELETE FROM qa_issues WHERE issue_type = 'glossary_violation' AND target_lang = $1`,
      [targetLang],
    );
  }

  /* ── 3. Fetch all strings with their best translation ──────────────── */
  let stringsSQL = `
    SELECT s.id AS string_id, s.text_raw AS source,
           t.id AS translation_id, t.text AS translation
    FROM strings s
    JOIN records r ON r.id = s.record_id
    JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $1
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence, 0) DESC, updated_at DESC
        LIMIT 1
      )
    WHERE t.text IS NOT NULL AND t.text <> ''`;

  const params: unknown[] = [targetLang];
  if (opts.modId) {
    stringsSQL += ` AND r.mod_id = $2`;
    params.push(opts.modId);
  }

  const { rows: strings } = await db.query(stringsSQL, params);

  /* ── 4. Build word-boundary checks and scan every string ───────────── */
  const checks = (glossaryTerms as Array<{ term: string; translation: string }>).map((g) => ({
    srcRe: termWordBoundaryRe(g.term),
    tgtNeedle: g.translation.toLowerCase(),
    term: g.term,
    translation: g.translation,
  }));

  let violations = 0;
  const insertValues: unknown[][] = [];

  for (const row of strings as Array<{ string_id: number; source: string; translation_id: number; translation: string }>) {
    const tgtLower = row.translation.toLowerCase();
    for (const c of checks) {
      if (c.srcRe.test(row.source) && !tgtLower.includes(c.tgtNeedle)) {
        insertValues.push([
          row.string_id,
          row.translation_id,
          targetLang,
          `Glossary: "${c.term}" should be translated as "${c.translation}".`,
        ]);
        violations++;
      }
    }
  }

  /* ── 5. Batch-insert all violations ────────────────────────────────── */
  for (const v of insertValues) {
    await db.query(
      `INSERT INTO qa_issues(src_string_id, translation_id, target_lang, issue_type, severity, message, is_active, updated_at)
       VALUES ($1, $2, $3, 'glossary_violation', 'warning', $4, TRUE, NOW())`,
      v,
    );
  }

  return { checked: strings.length, violations };
}

// ── Review queue ──────────────────────────────────────────────────────────────

/**
 * One row returned by the review queue — a translated string that needs
 * human review, including its mod context and current confidence score.
 */
export type ReviewQueueRow = {
  string_id: number;
  mod_id: number;
  mod_name: string;
  mod_game: string;
  formid_hex: string;
  signature: string;
  path: string;
  edid: string | null;
  source: string;
  translation_id: number;
  translation: string;
  status: string;
  /** Confidence in the range [0, 1].  Lower = higher review priority. */
  confidence: number | null;
  model: string | null;
  qa_issue_count: number;
};

/** Paginated result for the review queue. */
export type ReviewQueueResult = {
  rows: ReviewQueueRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Returns a cross-mod paginated list of translations whose status indicates
 * they need human review (auto / fuzzy / tm / draft by default), sorted by
 * confidence ascending so the least-certain strings surface first.
 *
 * @param db             - Database connection or pool.
 * @param targetLang     - Language code to query (e.g. 'uk').
 * @param statuses       - Array of translation statuses to include.
 * @param modId          - Optional: limit results to a single mod.
 * @param maxConfidence  - Optional: exclude strings with confidence > this value.
 * @param page           - 1-based page number.
 * @param pageSize       - Max rows per page (clamped to 1–200).
 */
export const listReviewQueue = async (
  db: Tx,
  targetLang: string,
  statuses: string[],
  modId: number | null,
  maxConfidence: number | null,
  page: number,
  pageSize: number,
  srcLang = CONFIG.defaultSrcLang,
): Promise<ReviewQueueResult> => {
  const effectivePage = Math.max(1, page);
  const effectivePageSize = Math.min(200, Math.max(1, pageSize));
  const offset = (effectivePage - 1) * effectivePageSize;

  // Guard: if no statuses requested, return empty immediately
  if (statuses.length === 0) {
    return { rows: [], total: 0, page: effectivePage, pageSize: effectivePageSize };
  }

  const conditions: string[] = [
    't.target_lang = $1',
    `s.lang = $${3}`,
    't.status = ANY($2)',
  ];
  const values: unknown[] = [targetLang, statuses, srcLang];
  let idx = 4;

  if (modId !== null) {
    conditions.push(`r.mod_id = $${idx}`);
    values.push(modId);
    idx++;
  }
  if (maxConfidence !== null) {
    // Include strings whose confidence is NULL (uncertain) or below/equal the threshold
    conditions.push(`(t.confidence IS NULL OR t.confidence <= $${idx})`);
    values.push(maxConfidence);
    idx++;
  }

  const where = conditions.join(' AND ');
  const pageSizeIdx = idx;
  const offsetIdx = idx + 1;
  const allValues = [...values, effectivePageSize, offset];

  const { rows } = await db.query<ReviewQueueRow>(
    `SELECT
      s.id              AS string_id,
      m.id              AS mod_id,
      m.name            AS mod_name,
      m.game            AS mod_game,
      r.formid_hex,
      r.signature,
      r.path,
      r.edid,
      s.text_raw        AS source,
      t.id              AS translation_id,
      t.text            AS translation,
      t.status,
      t.confidence,
      t.model,
      COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM translations t
     JOIN strings  s ON s.id = t.src_string_id
     JOIN records  r ON r.id = s.record_id
     JOIN mods     m ON m.id = r.mod_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $1 AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE ${where}
     ORDER BY t.confidence ASC NULLS LAST, t.updated_at ASC
     LIMIT $${pageSizeIdx} OFFSET $${offsetIdx}`,
    allValues,
  );

  const { rows: countRows } = await db.query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     WHERE ${where}`,
    values,
  );

  return {
    rows,
    total: Number(countRows[0]?.total ?? 0),
    page: effectivePage,
    pageSize: effectivePageSize,
  };
};

// ── Bulk status update ────────────────────────────────────────────────────────

// ── Coherence checking ────────────────────────────────────────────────────────

/**
 * A single string entry within a coherence group.
 * Represents one source string whose translation differs from at least one
 * other string that shares the same normalised source text.
 */
export type CoherenceEntry = {
  string_id: number;
  /** Raw (un-normalised) source text — used for informational display. */
  source_text: string;
  /** Normalised source text hash — the group key. */
  text_norm: string;
  edid: string | null;
  signature: string;
  path_simplified: string;
  mod_id: number;
  mod_name: string;
  /** Game identifier for the mod — used for editor deep-links. */
  mod_game: string;
  translation_id: number | null;
  /** Current best translation for this string. */
  translation: string;
  status: string;
};

/**
 * A coherence group — all strings sharing the same normalised source text
 * that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  text_norm: string;
  /** A representative raw source text for display purposes. */
  source_text: string;
  /** Number of distinct translation variants across all strings in this group. */
  variant_count: number;
  /** All string entries belonging to this group. */
  entries: CoherenceEntry[];
};

/**
 * Paginated coherence report result.
 */
export type CoherenceResult = {
  groups: CoherenceGroup[];
  /** Total number of inconsistency groups (before pagination). */
  total: number;
};

/**
 * Returns a paginated coherence report — groups of source strings that share
 * the same normalised text but have been translated inconsistently across
 * different strings/mods.
 *
 * Algorithm:
 * 1. For each source string, find its best translation (via BEST_TRANSLATION_ORDER).
 * 2. Group source strings by text_norm. Groups where COUNT(DISTINCT translation) > 1
 *    are inconsistent.
 * 3. Paginate over the inconsistent groups (ordered by variant_count DESC so the
 *    most conflicted groups appear first).
 * 4. For each group returned on the current page, fetch all member strings with
 *    their current translations.
 *
 * @param db       - Database connection or pool.
 * @param targetLang - Language code to check (e.g. 'uk').
 * @param limit    - Max number of groups per page.
 * @param offset   - Group offset for pagination.
 */
export const getCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  limit = 50,
  offset = 0,
  srcLang = CONFIG.defaultSrcLang,
): Promise<CoherenceResult> => {
  // CTE that selects the single best translation for every (string, lang) pair.
  // Reused in multiple queries below — defined as a SQL fragment for DRY usage.
  const btCte = `
    bt AS (
      SELECT DISTINCT ON (src_string_id, target_lang)
        src_string_id,
        text               AS translation,
        status,
        id                 AS translation_id,
        COALESCE(confidence, 0) AS conf,
        updated_at
      FROM translations
      WHERE target_lang = $1
      ORDER BY src_string_id, target_lang,
        ${BEST_TRANSLATION_ORDER},
        COALESCE(confidence, 0) DESC,
        updated_at DESC
    )`;

  // ── Step 1: total count of inconsistent groups ────────────────────────────
  const { rows: countRows } = await db.query<{ n: string }>(
    `WITH ${btCte}
     SELECT COUNT(*) AS n
     FROM (
       SELECT s.text_norm
       FROM   strings s
       JOIN   bt ON bt.src_string_id = s.id
       WHERE  s.lang = $2
         AND  s.text_norm IS NOT NULL
         AND  s.text_norm <> ''
       GROUP  BY s.text_norm
       HAVING COUNT(DISTINCT bt.translation) > 1
     ) x`,
    [targetLang, srcLang],
  );
  const total = Number(countRows[0]?.n ?? 0);

  if (total === 0) return { groups: [], total: 0 };

  // ── Step 2: paginated list of inconsistent text_norms ────────────────────
  const { rows: normRows } = await db.query<{
    text_norm: string;
    source_text: string;
    variant_count: string;
  }>(
    `WITH ${btCte}
     SELECT s.text_norm,
            MIN(s.text_raw)                    AS source_text,
            COUNT(DISTINCT bt.translation)     AS variant_count
     FROM   strings s
     JOIN   bt ON bt.src_string_id = s.id
     WHERE  s.lang = $2
       AND  s.text_norm IS NOT NULL
       AND  s.text_norm <> ''
     GROUP  BY s.text_norm
     HAVING COUNT(DISTINCT bt.translation) > 1
     ORDER  BY variant_count DESC, s.text_norm
     LIMIT  $3 OFFSET $4`,
    [targetLang, srcLang, limit, offset],
  );

  if (normRows.length === 0) return { groups: [], total };

  // ── Step 3: fetch all member strings for the norms on this page ──────────
  const textNorms = normRows.map((r) => r.text_norm);
  const { rows: entryRows } = await db.query<CoherenceEntry>(
    `WITH ${btCte}
     SELECT s.id             AS string_id,
            s.text_raw       AS source_text,
            s.text_norm,
            r.edid,
            r.signature,
            r.path_simplified,
            m.id             AS mod_id,
            m.name           AS mod_name,
            m.game           AS mod_game,
            bt.translation_id,
            bt.translation,
            bt.status
     FROM   strings s
     JOIN   bt       ON bt.src_string_id = s.id
     JOIN   records  r ON r.id = s.record_id
     JOIN   mods     m ON m.id = r.mod_id
     WHERE  s.lang = $2
       AND  s.text_norm = ANY($3)
     ORDER  BY s.text_norm, bt.translation, m.name`,
    [targetLang, srcLang, textNorms],
  );

  // ── Step 4: assemble groups in JS ────────────────────────────────────────
  // Build an index from norm → {source_text, variant_count} using normRows
  const normMeta = new Map(
    normRows.map((r) => [r.text_norm, { source_text: r.source_text, variant_count: Number(r.variant_count) }]),
  );

  // Group entry rows by text_norm, preserving the pagination order
  const groupMap = new Map<string, CoherenceEntry[]>();
  for (const entry of entryRows) {
    let list = groupMap.get(entry.text_norm);
    if (!list) {
      list = [];
      groupMap.set(entry.text_norm, list);
    }
    list.push(entry);
  }

  // Re-sort groups by normRows order (normRows is already ordered by variant_count DESC)
  const groups: CoherenceGroup[] = normRows
    .filter((r) => groupMap.has(r.text_norm))
    .map((r) => ({
      text_norm: r.text_norm,
      source_text: normMeta.get(r.text_norm)!.source_text,
      variant_count: normMeta.get(r.text_norm)!.variant_count,
      entries: groupMap.get(r.text_norm) ?? [],
    }));

  return { groups, total };
};

/**
 * Resolves all inconsistencies within a coherence group by applying a single
 * chosen translation to every string in the group that currently has a
 * different translation.
 *
 * Only strings that *already have a translation* (but a different one) are
 * updated. Strings without any translation are left untouched — the caller
 * should handle those separately if needed.
 *
 * All updates run inside a single transaction so either all succeed or none do.
 *
 * @param db                - Database pool (transaction is acquired internally).
 * @param textNorm          - The normalised source text that identifies the group.
 * @param targetLang        - Language code to update (e.g. 'uk').
 * @param chosenTranslation - The single translation text to propagate.
 * @returns Number of strings actually updated.
 */
export const resolveCoherenceGroup = async (
  db: Tx,
  textNorm: string,
  targetLang: string,
  chosenTranslation: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ updated: number }> => {
  // Find all strings in the group whose best translation differs from the chosen one
  const { rows } = await db.query<{ string_id: number }>(
    `WITH bt AS (
       SELECT DISTINCT ON (src_string_id, target_lang)
         src_string_id,
         text AS translation
       FROM translations
       WHERE target_lang = $1
       ORDER BY src_string_id, target_lang,
         ${BEST_TRANSLATION_ORDER},
         COALESCE(confidence, 0) DESC,
         updated_at DESC
     )
     SELECT s.id AS string_id
     FROM   strings s
     JOIN   bt ON bt.src_string_id = s.id
     WHERE  s.lang = $4
       AND  s.text_norm = $2
       AND  bt.translation <> $3`,
    [targetLang, textNorm, chosenTranslation, srcLang],
  );

  if (rows.length === 0) return { updated: 0 };

  // Apply the chosen translation to every differing string in a transaction
  await withTransaction(db as pg.Pool, async (client) => {
    for (const row of rows) {
      await upsertTranslation(
        client,
        row.string_id,
        chosenTranslation,
        'reviewed',
        targetLang,
        'coherence_resolve',
      );
    }
  });

  return { updated: rows.length };
};

export const bulkUpdateTranslationStatus = async (
  db: Tx,
  modId: number,
  stringIds: number[],
  newStatus: 'reviewed' | 'rejected',
  targetLang = CONFIG.defaultTgtLang,
  /** Actor performing the bulk action.  Passed through to the state machine. */
  actor: StatusActor = 'system',
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
      await updateTranslationStatus(client, row.translation_id, newStatus, actor);
      updated++;
    }
  });

  return updated;
}

// ── INNR editor ───────────────────────────────────────────────────────────────

/**
 * One component row within an INNR naming rule group.
 *
 * Fallout 4 Instance Naming Rules consist of multiple FormIDs grouped by a
 * shared EDID prefix (e.g. "ArmorMaterialSteel") with a numeric suffix
 * distinguishing individual slots (e.g. "001", "002").  Each slot provides
 * the component text string (FULL subrecord) that the game assembles into the
 * final item name.
 */
export type InnrRow = {
  string_id: number;
  formid_hex: string;
  /** Full EDID including numeric suffix, e.g. "ArmorMaterialSteel001". */
  edid: string | null;
  /** English source text (FULL subrecord). */
  source: string;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  qa_issue_count: number;
};

/**
 * A group of INNR component rows sharing the same base EDID prefix.
 *
 * Translators must see all slots of a naming rule together to maintain
 * grammatical agreement between component parts (material, quality, type, etc.).
 */
export type InnrGroup = {
  /** Base EDID without the numeric suffix (e.g. "ArmorMaterialSteel"). */
  base_edid: string;
  rows: InnrRow[];
};

/** Result returned by `listInnrGroups()`. */
export type InnrResult = {
  mod_id: number;
  mod_name: string;
  total_rows: number;
  groups: InnrGroup[];
};

/**
 * Fetches all INNR strings for a given mod, grouped by base EDID prefix.
 *
 * The grouping key is derived by stripping the trailing digit sequence from
 * each EDID, matching a heuristic approach for assembling compound
 * naming-rule component sets.
 *
 * Results are ordered by base EDID then by EDID (natural sort for suffix).
 *
 * @param db         - Database connection or pool.
 * @param modId      - Mod ID to query.
 * @param targetLang - Target language code (e.g. 'uk').
 * @param srcLang    - Source language code (default 'en').
 */
export const listInnrGroups = async (
  db: Tx,
  modId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<InnrResult> => {
  // Retrieve mod name for display
  const { rows: modRows } = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = modRows[0];
  if (!mod) return { mod_id: modId, mod_name: '', total_rows: 0, groups: [] };

  const { rows } = await db.query<InnrRow>(
    `SELECT
      s.id                          AS string_id,
      r.formid_hex,
      r.edid,
      s.text_raw                    AS source,
      t.id                          AS translation_id,
      t.text                        AS translation,
      t.status,
      t.confidence,
      COALESCE(q.issue_count, 0)    AS qa_issue_count
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $2
          AND t.id = (
            SELECT id FROM translations
            WHERE src_string_id = s.id AND target_lang = $2
            ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
            LIMIT 1
          )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $2 AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE r.mod_id = $1
       AND r.signature = 'INNR'
       AND s.lang = $3
     ORDER BY r.edid`,
    [modId, targetLang, srcLang],
  );

  // Group rows by base EDID prefix (strip trailing digit sequence)
  const groupMap = new Map<string, InnrRow[]>();
  for (const row of rows) {
    const baseEdid = (row.edid ?? '').replace(/\d+$/, '') || (row.edid ?? '');
    if (!groupMap.has(baseEdid)) groupMap.set(baseEdid, []);
    groupMap.get(baseEdid)!.push(row);
  }

  const groups: InnrGroup[] = [];
  for (const [base_edid, groupRows] of groupMap) {
    groups.push({ base_edid, rows: groupRows });
  }
  // Sort groups alphabetically by base EDID
  groups.sort((a, b) => a.base_edid.localeCompare(b.base_edid));

  return {
    mod_id: mod.id,
    mod_name: mod.name,
    total_rows: rows.length,
    groups,
  };
};
