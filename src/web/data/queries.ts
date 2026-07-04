import type { Tx } from '../../db';
import { withTransaction } from '../../db';
import type pg from 'pg';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import type { GameType } from '../../types';
import { findReferenceExamples, type RagReferenceExample } from '../../llm/ragService';
import { compareProtectedTokens } from '../../utils/placeholders';
import { parseRecordLocation } from '../../utils/recordLocation';
import type { TranslationStatus } from './statusMachine';
import { scheduleRagSync } from '../services/ragHooks';
import { bulkUpsertImportTranslations, type BulkTranslationRow } from '../import/modImportBulk';
import {
  type DeferredBulkWriteIndexContext,
  withDeferredBulkModWriteIndexes,
} from '../import/modImportIndexes';

// Re-export so existing callers that import TranslationStatus from queries.ts
// continue to work without changes.
export type { TranslationStatus } from './statusMachine';

const BEST_TRANSLATION_ORDER = `CASE status
  WHEN 'skip' THEN 0
  WHEN 'draft' THEN 1
  WHEN 'reviewed' THEN 2
  WHEN 'human' THEN 3
  WHEN 'tm' THEN 4
  WHEN 'fuzzy' THEN 5
  WHEN 'auto' THEN 6
  WHEN 'rejected' THEN 7
  ELSE 8 END`;

const APPROVED_STATUS_SQL = `('reviewed', 'human')`;

/** Translation statuses still eligible for automated LLM review and QA validation. */
export const PENDING_REVIEW_STATUS_SQL = `('draft', 'tm', 'fuzzy', 'auto')`;

/** Translation statuses included when CLI auto-verify runs with `--force`. */
export const LLM_VERIFY_FORCE_STATUS_SQL = `('draft', 'tm', 'fuzzy', 'auto', 'reviewed', 'human')`;

/** SQL `IN (...)` list for mod-wide LLM verify row selection. */
export const llmVerifyEligibleStatusSql = (force: boolean): string =>
  force ? LLM_VERIFY_FORCE_STATUS_SQL : PENDING_REVIEW_STATUS_SQL;

/** Translation statuses that LLM translate/verify must never overwrite or re-process. */
export const LLM_PROTECTED_TRANSLATION_STATUS_SQL = `('reviewed', 'human', 'rejected')`;

/** How CLI / mod-wide LLM translate selects existing translations to overwrite. */
export type LlmTranslateOverwriteMode = 'default' | 'force' | 'force-all';

/** SQL predicate on LEFT JOIN translations t — combined with s.is_ignored = FALSE elsewhere. */
export const llmTranslateEligibilitySql = (mode: LlmTranslateOverwriteMode): string => {
  switch (mode) {
    case 'default':
      return 't.id IS NULL';
    case 'force':
      return `(t.id IS NULL OR t.status NOT IN ${LLM_PROTECTED_TRANSLATION_STATUS_SQL})`;
    case 'force-all':
      return 'TRUE';
  }
};

const PENDING_REVIEW_STATUSES = new Set<TranslationStatus>(['draft', 'tm', 'fuzzy', 'auto']);

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

/** Mixed-case glossary entries are proper nouns; do not match lower-case common words in source. */
export const glossaryTermMatchesSource = (source: string, term: string): boolean => {
  if (/^[A-Z]/.test(term) && term !== term.toUpperCase()) {
    return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(source);
  }
  return termWordBoundaryRe(term).test(source);
};

/**
 * Per-run QA check settings loaded from `project_settings` before each
 * `refreshQAIssues` call.  Passed to `buildQAIssues` so the function stays pure.
 */
type QACheckSettings = {
  /** When true (default), flag a QA warning if source and translation end with different sentence-ending punctuation. */
  endPunctMatch: boolean;
  /** Minimum word count required in a translation (1 = default — single word is fine). */
  minWordCount: number;
};

/** Regex that matches the last sentence-ending punctuation of a string. */
const END_PUNCT_RE = /[.!?…]$/;

/**
 * Extracts the last sentence-ending punctuation character from a string, or
 * returns null when the string does not end with one.
 */
const lastEndPunct = (s: string): string | null => s.trimEnd().match(END_PUNCT_RE)?.[0] ?? null;

const buildQAIssues = (
  source: string,
  translation: string,
  game?: GameType | null,
  settings?: Partial<QACheckSettings>,
  tokenContext?: { grup?: string | null; field?: string | null },
): QAIssueInput[] => {
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

  const tokenCheck = compareProtectedTokens(source, translation, game, tokenContext);
  if (!tokenCheck.ok) {
    issues.push({
      issueType: 'placeholder_mismatch',
      severity: 'error',
      message: tokenCheck.message,
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
    const unique = [...new Set(forbidden)].map(
      (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
    );
    issues.push({
      issueType: 'forbidden_chars',
      severity: 'error',
      message: `Contains forbidden control characters: ${unique.join(', ')}`,
    });
  }

  // ── Project-settings-driven checks ─────────────────────────────────────
  // These checks are only applied when the corresponding project setting is
  // enabled (both default to enabled).

  // End-punctuation match: source and translation must end with the same
  // sentence-ending punctuation character (.  !  ?  …).
  if (settings?.endPunctMatch !== false) {
    const srcPunct = lastEndPunct(source);
    const dstPunct = lastEndPunct(trimmed);
    if (srcPunct !== null && dstPunct !== srcPunct) {
      issues.push({
        issueType: 'end_punct_mismatch',
        severity: 'warning',
        message: `Trailing punctuation mismatch: source ends with "${srcPunct}" but translation ends with "${dstPunct ?? '(none)'}".`,
      });
    }
  }

  // Minimum word count: translation must contain at least N words.
  // Only evaluated when minWordCount > 1 (1 is the lowest meaningful
  // threshold and is already covered by the empty_translation check).
  const minWords = settings?.minWordCount ?? 1;
  if (minWords > 1) {
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount < minWords) {
      issues.push({
        issueType: 'min_word_count',
        severity: 'warning',
        message: `Translation has ${wordCount} word(s), minimum required is ${minWords}.`,
      });
    }
  }

  return issues;
};

type QaRuleRow = {
  rule_type: string;
  value: string;
  severity: string;
  description: string | null;
  rule_sig: string | null;
  rule_path: string | null;
};

const qaRuleGameKey = (game: string | null | undefined): string =>
  game === 'fo76' ? 'fo4' : (game ?? 'fo4');

const loadQaCheckSettings = async (db: Tx): Promise<QACheckSettings> => {
  const { rows: settingRows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM project_settings WHERE key IN ('qa.end_punct_match', 'qa.min_word_count')`,
  );
  const qaSettings: QACheckSettings = { endPunctMatch: true, minWordCount: 1 };
  for (const s of settingRows) {
    if (s.key === 'qa.end_punct_match') qaSettings.endPunctMatch = Boolean(s.value);
    if (s.key === 'qa.min_word_count') qaSettings.minWordCount = Number(s.value);
  }
  return qaSettings;
};

const loadGlossaryTermsForQa = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
): Promise<Array<{ term: string; translation: string }>> => {
  const { rows } = await db.query<{ term: string; translation: string }>(
    `SELECT term, translation FROM glossary
     WHERE src_lang = $1 AND tgt_lang = $2 AND translation IS NOT NULL`,
    [srcLang, targetLang],
  );
  return rows;
};

const loadQaRulesForGame = async (db: Tx, game: string): Promise<QaRuleRow[]> => {
  const { rows } = await db.query<QaRuleRow>(
    `SELECT rule_type, value, severity, description, signature AS rule_sig, path AS rule_path
     FROM qa_rules
     WHERE game = $1 AND is_active = TRUE`,
    [game],
  );
  return rows;
};

const applyConfigurableQaRules = (
  issues: QAIssueInput[],
  translation: string,
  signature: string | null | undefined,
  path: string | null | undefined,
  qaRules: QaRuleRow[],
): void => {
  for (const rule of qaRules) {
    if (rule.rule_sig && rule.rule_sig !== signature) continue;
    if (rule.rule_path && rule.rule_path !== path) continue;

    if (rule.rule_type === 'forbidden_chars') {
      const found: string[] = [];
      for (const ch of rule.value) {
        if (translation.includes(ch)) found.push(ch);
      }
      if (found.length > 0) {
        const display = found.map((c) => {
          const cp = c.codePointAt(0)!;
          return cp >= 0x20 && cp < 0x7f
            ? `"${c}"`
            : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
        });
        issues.push({
          issueType: 'forbidden_chars',
          severity: rule.severity as 'warning' | 'error',
          message: rule.description ?? `Forbidden characters found: ${display.join(', ')}`,
        });
      }
    } else if (rule.rule_type === 'max_length') {
      const maxLen = parseInt(rule.value, 10);
      if (!Number.isNaN(maxLen) && translation.length > maxLen) {
        issues.push({
          issueType: 'max_length',
          severity: rule.severity as 'warning' | 'error',
          message:
            rule.description ??
            `Translation is ${translation.length} chars, exceeds max ${maxLen}.`,
        });
      }
    }
  }
};

const applyGlossaryQaIssues = (
  issues: QAIssueInput[],
  source: string,
  translation: string,
  glossaryTerms: Array<{ term: string; translation: string }>,
): void => {
  const tgtLower = translation.toLowerCase();
  for (const g of glossaryTerms) {
    if (
      glossaryTermMatchesSource(source, g.term) &&
      !tgtLower.includes(g.translation.toLowerCase())
    ) {
      issues.push({
        issueType: 'glossary_violation',
        severity: 'warning',
        message: `Glossary: "${g.term}" should be translated as "${g.translation}".`,
      });
    }
  }
};

const appendDuplicateInconsistencyIssue = (issues: QAIssueInput[], altTexts: string[]): void => {
  if (altTexts.length === 0) return;
  const alts = altTexts.map((text) => `"${text}"`).join(', ');
  issues.push({
    issueType: 'duplicate_inconsistency',
    severity: 'warning',
    message: `Same source text is translated differently elsewhere: ${alts}`,
  });
};

type QaTranslationContextRow = {
  source: string;
  is_ignored?: boolean;
  translation_id?: number | null;
  translation?: string | null;
  translation_status?: TranslationStatus | null;
  signature?: string | null;
  path?: string | null;
  game?: string;
};

const collectQAIssuesForRow = (
  row: QaTranslationContextRow,
  qaSettings: QACheckSettings,
  qaRules: QaRuleRow[],
  glossaryTerms: Array<{ term: string; translation: string }>,
  duplicateAlts: string[],
): QAIssueInput[] => {
  if (!row.source || row.translation == null || row.is_ignored) return [];
  if (row.translation_status && !PENDING_REVIEW_STATUSES.has(row.translation_status)) {
    return [];
  }

  const issues = buildQAIssues(
    row.source,
    row.translation,
    row.game as GameType | undefined,
    qaSettings,
    parseRecordLocation(row.signature, row.path),
  );
  applyConfigurableQaRules(issues, row.translation, row.signature, row.path, qaRules);
  applyGlossaryQaIssues(issues, row.source, row.translation, glossaryTerms);
  appendDuplicateInconsistencyIssue(issues, duplicateAlts);
  return issues;
};

const bulkInsertQAIssues = async (
  db: Tx,
  rows: Array<{
    stringId: number;
    translationId: number | null;
    targetLang: string;
    issueType: string;
    severity: string;
    message: string;
  }>,
): Promise<void> => {
  if (rows.length === 0) return;
  await db.query(
    `INSERT INTO qa_issues(
       src_string_id, translation_id, target_lang, issue_type, severity, message, is_active, updated_at
     )
     SELECT s, tid, tl, it, sev, msg, TRUE, NOW()
     FROM UNNEST(
       $1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[]
     ) AS u(s, tid, tl, it, sev, msg)`,
    [
      rows.map((r) => r.stringId),
      rows.map((r) => r.translationId),
      rows.map((r) => r.targetLang),
      rows.map((r) => r.issueType),
      rows.map((r) => r.severity),
      rows.map((r) => r.message),
    ],
  );
};

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
};

const refreshQAIssues = async (
  db: Tx,
  stringId: number,
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<void> => {
  await refreshQAIssuesBatch(db, [stringId], targetLang, srcLang);
};

/**
 * Recompute QA issues for many strings in one pass — shared settings/glossary loads,
 * batched delete/insert. Used by the LLM auto-translate pipeline (async).
 */
export const refreshQAIssuesBatch = async (
  db: Tx,
  stringIds: number[],
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
  opts?: { skipDuplicateCheck?: boolean },
): Promise<void> => {
  if (stringIds.length === 0) return;

  const qaSettings = await loadQaCheckSettings(db);
  const glossaryTerms = await loadGlossaryTermsForQa(db, srcLang, targetLang);

  const { rows } = await db.query<QaTranslationContextRow & { string_id: number }>(
    `SELECT s.id AS string_id,
            s.text_raw AS source, s.is_ignored,
            t.id AS translation_id, t.text AS translation, t.status AS translation_status,
            r.signature, r.path, m.game
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE s.id = ANY($1::int[])`,
    [stringIds, targetLang],
  );

  await db.query(
    `DELETE FROM qa_issues WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
    [stringIds, targetLang],
  );

  const duplicateAltsByStringId = new Map<number, string[]>();
  if (!opts?.skipDuplicateCheck) {
    const { rows: duplicateRows } = await db.query<{ string_id: number; alt_text: string }>(
      `SELECT s1.id AS string_id, t2.text AS alt_text
       FROM strings s1
       JOIN translations t1 ON t1.src_string_id = s1.id AND t1.target_lang = $2
       JOIN strings s2
         ON s2.text_norm = s1.text_norm AND s2.lang = s1.lang AND s2.id <> s1.id
        AND s1.text_norm IS NOT NULL AND s1.text_norm <> ''
       JOIN translations t2 ON t2.src_string_id = s2.id AND t2.target_lang = $2
       WHERE s1.id = ANY($1::int[])
         AND t2.text <> t1.text`,
      [stringIds, targetLang],
    );
    for (const dup of duplicateRows) {
      const existing = duplicateAltsByStringId.get(dup.string_id) ?? [];
      if (!existing.includes(dup.alt_text)) existing.push(dup.alt_text);
      duplicateAltsByStringId.set(dup.string_id, existing);
    }
  }

  const qaRulesByGame = new Map<string, QaRuleRow[]>();
  const issueRows: Array<{
    stringId: number;
    translationId: number | null;
    targetLang: string;
    issueType: string;
    severity: string;
    message: string;
  }> = [];

  for (const row of rows) {
    const gameKey = qaRuleGameKey(row.game);
    let qaRules = qaRulesByGame.get(gameKey);
    if (!qaRules) {
      qaRules = await loadQaRulesForGame(db, gameKey);
      qaRulesByGame.set(gameKey, qaRules);
    }

    const issues = collectQAIssuesForRow(
      row,
      qaSettings,
      qaRules,
      glossaryTerms,
      (duplicateAltsByStringId.get(row.string_id) ?? []).slice(0, 5),
    );
    for (const issue of issues) {
      issueRows.push({
        stringId: row.string_id,
        translationId: row.translation_id ?? null,
        targetLang,
        issueType: issue.issueType,
        severity: issue.severity,
        message: issue.message,
      });
    }
  }

  await bulkInsertQAIssues(db, issueRows);
};

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
  const srcLang = opts.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  /* Optional game filter on the outer mods row set. */
  const whereClause = opts.game ? 'WHERE m.game = $3' : '';
  const params: unknown[] = [srcLang, targetLang];
  if (opts.game) params.push(opts.game);

  /*
   * Aggregate per mod in separate subqueries. A single GROUP BY over four
   * LEFT JOINs makes PostgreSQL nest-loop every string row against all
   * translations for the target lang (~215k × 7k = 1.5B row comparisons).
   */
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
      COALESCE(rs.record_count, 0)::bigint          AS record_count,
      COALESCE(ss.string_count, 0)::bigint         AS string_count,
      COALESCE(ts.translated_count, 0)::bigint     AS translated_count,
      COALESCE(ts.approved_count, 0)::bigint       AS approved_count,
      COALESCE(ts.fuzzy_count, 0)::bigint          AS fuzzy_count
     FROM mods m
     LEFT JOIN (
       SELECT mod_id, COUNT(*)::bigint AS record_count
       FROM records
       GROUP BY mod_id
     ) rs ON rs.mod_id = m.id
     LEFT JOIN (
       SELECT r.mod_id, COUNT(s.id)::bigint AS string_count
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $1
       GROUP BY r.mod_id
     ) ss ON ss.mod_id = m.id
     LEFT JOIN (
       SELECT r.mod_id,
         COUNT(t.id)::bigint AS translated_count,
         COUNT(*) FILTER (WHERE t.status IN ${APPROVED_STATUS_SQL})::bigint AS approved_count,
         COUNT(*) FILTER (WHERE t.status = 'fuzzy')::bigint AS fuzzy_count
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $1
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       GROUP BY r.mod_id
     ) ts ON ts.mod_id = m.id
     ${whereClause}
     ORDER BY m.created_at DESC`,
    params,
  );
  return rows;
};

export const getMod = async (db: Tx, id: number) => {
  const { rows } = await db.query(`SELECT * FROM mods WHERE id = $1`, [id]);
  return rows[0];
};

/**
 * Remove imported data for one or more mods without relying on FK CASCADE.
 *
 * PostgreSQL CASCADE on large mods is slow: each deleted string triggers a
 * per-row SET NULL on dialog_nodes, and translation_examples HNSW updates run
 * row-by-row. Explicit bulk DELETE/UPDATE statements use set-based plans instead.
 * Heavy pg_trgm/HASH indexes and the RAG HNSW index are dropped for the purge
 * window when MOD_IMPORT_DEFER_INDEXES is enabled (default).
 *
 * @param scope - `rows` keeps mod rows; `mod` also removes dialog graph + mods.
 */
const deleteModDataOnClient = async (
  client: Tx,
  uniqueModIds: number[],
  scope: 'rows' | 'mod',
  indexCtx: DeferredBulkWriteIndexContext,
): Promise<{ deletedRecords: number }> => {
  const TE_CHUNK = CONFIG.dbChunkSize;

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE dialog_nodes dn
          SET response_string_id = NULL
         FROM strings s
         JOIN records r ON s.record_id = r.id
        WHERE dn.response_string_id = s.id
          AND r.mod_id = ANY($1::int[])`,
      [uniqueModIds],
    );

    if (indexCtx.hnswDropped) {
      await client.query(
        `DELETE FROM translation_examples te
          USING translations t
          JOIN strings s ON t.src_string_id = s.id
          JOIN records r ON s.record_id = r.id
         WHERE te.translation_id = t.id
           AND r.mod_id = ANY($1::int[])`,
        [uniqueModIds],
      );
    } else {
      for (;;) {
        const { rowCount } = await client.query(
          `DELETE FROM translation_examples te
            WHERE te.translation_id IN (
              SELECT t.id
                FROM translations t
                JOIN strings s ON t.src_string_id = s.id
                JOIN records r ON s.record_id = r.id
               WHERE r.mod_id = ANY($1::int[])
               LIMIT $2
            )`,
          [uniqueModIds, TE_CHUNK],
        );
        if (!rowCount || rowCount < TE_CHUNK) break;
      }
    }

    await client.query(
      `DELETE FROM qa_issues qi
        USING strings s
        JOIN records r ON s.record_id = r.id
       WHERE qi.src_string_id = s.id
         AND r.mod_id = ANY($1::int[])`,
      [uniqueModIds],
    );

    await client.query(
      `DELETE FROM translation_revisions tr
        USING strings s
        JOIN records r ON s.record_id = r.id
       WHERE tr.src_string_id = s.id
         AND r.mod_id = ANY($1::int[])`,
      [uniqueModIds],
    );

    await client.query(
      `DELETE FROM translations t
        USING strings s
        JOIN records r ON s.record_id = r.id
       WHERE t.src_string_id = s.id
         AND r.mod_id = ANY($1::int[])`,
      [uniqueModIds],
    );

    await client.query(
      `DELETE FROM strings s
        USING records r
       WHERE s.record_id = r.id
         AND r.mod_id = ANY($1::int[])`,
      [uniqueModIds],
    );

    const { rowCount } = await client.query(`DELETE FROM records WHERE mod_id = ANY($1::int[])`, [
      uniqueModIds,
    ]);

    if (scope === 'mod') {
      await client.query(
        `DELETE FROM dialog_scene_phases dsp
          WHERE dsp.scene_id IN (SELECT id FROM dialog_scenes WHERE mod_id = ANY($1::int[]))
             OR dsp.topic_id IN (SELECT id FROM dialog_topics WHERE mod_id = ANY($1::int[]))`,
        [uniqueModIds],
      );
      await client.query(
        `DELETE FROM dialog_edges de
          USING dialog_topics dt
         WHERE de.topic_id = dt.id
           AND dt.mod_id = ANY($1::int[])`,
        [uniqueModIds],
      );
      await client.query(
        `DELETE FROM dialog_nodes dn
          USING dialog_topics dt
         WHERE dn.topic_id = dt.id
           AND dt.mod_id = ANY($1::int[])`,
        [uniqueModIds],
      );
      await client.query(`DELETE FROM dialog_scenes WHERE mod_id = ANY($1::int[])`, [uniqueModIds]);
      await client.query(`DELETE FROM dialog_topics WHERE mod_id = ANY($1::int[])`, [uniqueModIds]);
      await client.query(`DELETE FROM mods WHERE id = ANY($1::int[])`, [uniqueModIds]);
    }

    await client.query('COMMIT');
    return { deletedRecords: rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
};

export const deleteModDataForModIds = async (
  db: Tx,
  modIds: number[],
  scope: 'rows' | 'mod',
): Promise<{ deletedRecords: number }> => {
  const uniqueModIds = [...new Set(modIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueModIds.length === 0) {
    return { deletedRecords: 0 };
  }

  const started = Date.now();

  const result = await withDeferredBulkModWriteIndexes(
    db,
    CONFIG.modImportDeferIndexes,
    (client, indexCtx) => deleteModDataOnClient(client, uniqueModIds, scope, indexCtx),
  );

  log.info(
    `deleteModData modIds=${uniqueModIds.join(',')} scope=${scope} records=${result.deletedRecords} deferIndexes=${CONFIG.modImportDeferIndexes} ms=${Date.now() - started}`,
  );
  return result;
};

/** @see deleteModDataForModIds */
export const deleteModData = async (
  db: Tx,
  modId: number,
  scope: 'rows' | 'mod',
): Promise<{ deletedRecords: number }> => deleteModDataForModIds(db, [modId], scope);

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
  /** When true, strings with is_ignored = TRUE are excluded from results. */
  hideIgnored?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
};

/** Parses a comma-separated status filter (`draft,reviewed`) into unique tokens. */
export const parseStatusFilter = (status?: string): string[] => {
  if (!status || status === 'all') return [];
  return [
    ...new Set(
      status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
};

const statusFilterNeedsTranslationJoin = (statuses: string[]): boolean => {
  if (statuses.length === 0) return false;
  const onlySkip = statuses.every((s) => s === 'skip');
  const onlyUntranslated = statuses.length === 1 && statuses[0] === 'untranslated';
  return !onlySkip && !onlyUntranslated;
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

/**
 * Builds the shared WHERE-clause fragments used by {@link listStrings} and
 * {@link listMatchingStringIds}.
 *
 * Param `$1` is always reserved for `modId` (already pushed into `values`),
 * so callers should start their own positional params at the returned `idx`.
 * The fragments reference the standard aliases `r` (records), `s` (strings)
 * and `t` (best translation, LEFT JOINed by the caller).
 *
 * @param f         The string filter.
 * @param startIdx  First positional-parameter index to assign (normally `2`).
 * @returns         `conditions` (joined with AND by the caller), the matching
 *                  `values`, and the next free param `idx`.
 */
const buildStringFilterConditions = (
  f: StringsFilter,
  startIdx = 2,
  opts?: { targetLang?: string; forCount?: boolean },
): { conditions: string[]; values: unknown[]; idx: number } => {
  const conditions: string[] = ['r.mod_id = $1'];
  const values: unknown[] = [f.modId];
  let idx = startIdx;

  if (f.status && f.status !== 'all') {
    const statuses = parseStatusFilter(f.status);
    if (statuses.length > 0) {
      const parts: string[] = [];
      let untranslatedLangIdx: number | null = null;

      for (const st of statuses) {
        if (st === 'untranslated') {
          if (opts?.forCount && opts.targetLang) {
            if (untranslatedLangIdx === null) {
              untranslatedLangIdx = idx;
              values.push(opts.targetLang);
              idx++;
            }
            parts.push(
              `(s.is_ignored = FALSE AND NOT EXISTS (SELECT 1 FROM translations t_miss WHERE t_miss.src_string_id = s.id AND t_miss.target_lang = $${untranslatedLangIdx}))`,
            );
          } else {
            parts.push('(s.is_ignored = FALSE AND t.id IS NULL)');
          }
        } else if (st === 'skip') {
          parts.push('(s.is_ignored = TRUE)');
        } else {
          parts.push(`(s.is_ignored = FALSE AND t.status = $${idx})`);
          values.push(st);
          idx++;
        }
      }

      conditions.push(parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`);
    }
  }

  if (f.signature) {
    conditions.push(`r.signature = $${idx}`);
    values.push(f.signature);
    idx++;
  }

  if (f.query) {
    conditions.push(
      `(s.text_raw LIKE $${idx} OR r.formid_hex LIKE $${idx} OR r.edid LIKE $${idx})`,
    );
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

  if (f.hideIgnored) {
    conditions.push(`s.is_ignored = FALSE`);
  }

  return { conditions, values, idx };
};

export const listStrings = async (db: Tx, f: StringsFilter) => {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const srcLang = f.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = f.targetLang ?? CONFIG.defaultTgtLang;

  const { conditions, values, idx } = buildStringFilterConditions(f);
  const where = conditions.join(' AND ');

  /* QA-issue existence predicate, parameterised on the target-lang index. */
  const qaExists = (langIdx: number) =>
    `EXISTS (SELECT 1 FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${langIdx} AND qi.is_active = TRUE)`;

  /* ── Page query ───────────────────────────────────────────────────────────
   * The translations join is always needed (translation columns are shown).
   * A (src_string_id, target_lang) unique index guarantees at most one
   * translation per pair, so this is a plain index join — no per-row
   * "best translation" subquery. With a specific status filter the planner
   * can drive the join from idx_translations_by_lang (target_lang, status).
   * The QA issue-count LATERAL is intentionally kept out of WHERE / ORDER BY
   * so the planner can defer it to only the rows that survive LIMIT. When the
   * caller wants QA-only rows we filter with EXISTS (index-backed) instead of
   * forcing the per-row COUNT across the whole mod. */
  const targetLangIdx = idx;
  const srcLangIdx = idx + 1;
  const limitIdx = idx + 2;
  const offsetIdx = idx + 3;
  const allValues = [...values, targetLang, srcLang, pageSize, offset];

  const orderBy = `${SORT_COLUMNS[f.sort ?? ''] ? `${SORT_COLUMNS[f.sort!]} ${f.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST,` : ''} r.signature, r.path`;

  /* Paginate on narrow rows first (id + sort keys), then fetch text columns for
   * the single page. Without this, some filters (skip / untranslated) tempt the
   * planner into a strings-first seq scan that reads text_raw for the whole
   * table before LIMIT — multi-second loads on large mods. */
  const pageSql = `WITH page AS (
       SELECT s.id AS string_id
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $${srcLangIdx}
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
       WHERE ${where}${f.qaOnly ? ` AND ${qaExists(targetLangIdx)}` : ''}
       ORDER BY ${orderBy}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}
     )
     SELECT
      s.id            AS string_id,
      r.formid_hex,
      r.signature,
      r.path,
      r.edid,
      s.text_raw      AS source,
      s.context,
      s.is_ignored,
      t.id            AS translation_id,
      t.text          AS translation,
      CASE WHEN s.is_ignored THEN 'skip' ELSE t.status END AS status,
      t.confidence,
      t.provenance,
      t.model,
      t.updated_at,
      COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM page
     JOIN strings s ON s.id = page.string_id
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${targetLangIdx} AND qi.is_active = TRUE
     ) q ON TRUE
     ORDER BY ${orderBy}`;

  /* ── Count query ──────────────────────────────────────────────────────────
   * Runs only on page 1 (subsequent infinite-scroll pages reuse the total).
   * Join translations only when a translation-column filter requires it
   * (status = draft/reviewed/… or translation-text ILIKE). Skip and
   * untranslated use strings-side predicates (is_ignored / NOT EXISTS). */
  const buildCountQuery = (): { sql: string; values: unknown[] } | null => {
    if (page > 1) return null;

    const statuses = parseStatusFilter(f.status);
    const onlyUntranslated = statuses.length === 1 && statuses[0] === 'untranslated';
    const needsTxJoin = !!f.transl || statusFilterNeedsTranslationJoin(statuses);

    if (needsTxJoin) {
      const cTgt = idx;
      const cSrc = idx + 1;
      return {
        sql: `SELECT COUNT(*) AS total
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $${cTgt}
       WHERE s.lang = $${cSrc} AND ${where}${f.qaOnly ? ` AND ${qaExists(cTgt)}` : ''}`,
        values: [...values, targetLang, srcLang],
      };
    }

    if (onlyUntranslated) {
      const {
        conditions: countConditions,
        values: countConds,
        idx: countIdx,
      } = buildStringFilterConditions(f, 2, { targetLang, forCount: true });
      const countWhere = countConditions.join(' AND ');
      const cSrc = countIdx;
      const cTgt = 2; // targetLang already bound for NOT EXISTS — reuse for qaExists
      return {
        sql: `SELECT COUNT(*) AS total
       FROM strings s
       JOIN records r ON s.record_id = r.id
       WHERE s.lang = $${cSrc} AND ${countWhere}${f.qaOnly ? ` AND ${qaExists(cTgt)}` : ''}`,
        values: [...countConds, srcLang],
      };
    }

    if (f.qaOnly) {
      const cTgt = idx;
      const cSrc = idx + 1;
      return {
        sql: `SELECT COUNT(*) AS total
       FROM strings s
       JOIN records r ON s.record_id = r.id
       WHERE s.lang = $${cSrc} AND ${where} AND ${qaExists(cTgt)}`,
        values: [...values, targetLang, srcLang],
      };
    }

    const cSrc = idx;
    return {
      sql: `SELECT COUNT(*) AS total
       FROM strings s
       JOIN records r ON s.record_id = r.id
       WHERE s.lang = $${cSrc} AND ${where}`,
      values: [...values, srcLang],
    };
  };

  const countQuery = buildCountQuery();
  const [pageResult, countResult] = await Promise.all([
    db.query(pageSql, allValues),
    countQuery ? db.query(countQuery.sql, countQuery.values) : Promise.resolve(null),
  ]);
  const rows = pageResult.rows;
  const total = countResult ? Number(countResult.rows[0].total) : 0;

  return { rows, total, page, pageSize };
};

export const listSignatures = async (
  db: Tx,
  f: Omit<StringsFilter, 'page' | 'pageSize' | 'sort' | 'order' | 'signature'>,
) => {
  const srcLang = f.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = f.targetLang ?? CONFIG.defaultTgtLang;
  const statuses = parseStatusFilter(f.status);

  const hasExtraFilters =
    statuses.length > 0 ||
    f.qaOnly ||
    !!f.query ||
    !!f.grup ||
    !!f.formid ||
    !!f.edid ||
    !!f.field ||
    !!f.src ||
    !!f.transl ||
    f.hideIgnored;

  if (!hasExtraFilters) {
    const { rows } = await db.query(
      `SELECT r.signature, COUNT(*)::int AS count
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       WHERE r.mod_id = $1
       GROUP BY r.signature
       ORDER BY count DESC`,
      [f.modId, srcLang],
    );
    return rows;
  }

  const { conditions, values, idx } = buildStringFilterConditions(f);
  const where = conditions.join(' AND ');
  const qaExists = (langIdx: number) =>
    `EXISTS (SELECT 1 FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${langIdx} AND qi.is_active = TRUE)`;

  const onlyUntranslated = statuses.length === 1 && statuses[0] === 'untranslated';
  const needsTxJoin = !!f.transl || statusFilterNeedsTranslationJoin(statuses);

  if (needsTxJoin) {
    const targetLangIdx = idx;
    const srcLangIdx = idx + 1;
    const { rows } = await db.query(
      `SELECT r.signature, COUNT(*)::int AS count
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $${srcLangIdx}
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
       WHERE ${where}${f.qaOnly ? ` AND ${qaExists(targetLangIdx)}` : ''}
       GROUP BY r.signature
       HAVING COUNT(*) > 0
       ORDER BY count DESC`,
      [...values, targetLang, srcLang],
    );
    return rows;
  }

  if (onlyUntranslated) {
    const {
      conditions: countConditions,
      values: countConds,
      idx: countIdx,
    } = buildStringFilterConditions(f, 2, { targetLang, forCount: true });
    const countWhere = countConditions.join(' AND ');
    const cSrc = countIdx;
    const cTgt = 2;
    const { rows } = await db.query(
      `SELECT r.signature, COUNT(*)::int AS count
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $${cSrc}
       WHERE ${countWhere}${f.qaOnly ? ` AND ${qaExists(cTgt)}` : ''}
       GROUP BY r.signature
       HAVING COUNT(*) > 0
       ORDER BY count DESC`,
      [...countConds, srcLang],
    );
    return rows;
  }

  const cSrc = idx;
  const cTgt = idx + 1;
  const countValues = f.qaOnly ? [...values, srcLang, targetLang] : [...values, srcLang];
  const { rows } = await db.query(
    `SELECT r.signature, COUNT(*)::int AS count
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $${cSrc}
     WHERE ${where}${f.qaOnly ? ` AND ${qaExists(cTgt)}` : ''}
     GROUP BY r.signature
     HAVING COUNT(*) > 0
     ORDER BY count DESC`,
    countValues,
  );
  return rows;
};

export type DialogTopicRow = {
  topic_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_count: number;
};

export type DialogTreeNodeRow = {
  node_id: number;
  info_formid_hex: string;
  previous_info_formid_hex: string | null;
  speaker_formid_hex: string | null;
  speaker_name: string | null;
  string_id: number | null;
  source: string | null;
  context: string | null;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
};

export type DialogTreeEdgeRow = {
  edge_id: number;
  from_info_formid_hex: string;
  to_info_formid_hex: string;
  edge_kind: string;
  confidence: string;
};

/**
 * List dialog topics available for a mod.
 *
 * @param db - Database handle.
 * @param modId - Mod id.
 */
export const listDialogTopics = async (db: Tx, modId: number): Promise<DialogTopicRow[]> => {
  const { rows } = await db.query(
    `SELECT
       dt.id AS topic_id,
       dt.formid_hex AS topic_formid_hex,
       dt.edid AS topic_edid,
       COUNT(dn.id)::int AS node_count
     FROM dialog_topics dt
     LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
     WHERE dt.mod_id = $1
     GROUP BY dt.id, dt.formid_hex, dt.edid
     ORDER BY node_count DESC, dt.formid_hex ASC`,
    [modId],
  );
  return rows as DialogTopicRow[];
};

/**
 * Load a full dialog tree payload (nodes + edges) for a topic id.
 *
 * @param db - Database handle.
 * @param topicId - Dialog topic id.
 * @param srcLang - Source language for node text.
 * @param targetLang - Target language for best-translation join.
 */
export const getDialogTree = async (
  db: Tx,
  topicId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ nodes: DialogTreeNodeRow[]; edges: DialogTreeEdgeRow[] }> => {
  const { rows: nodeRows } = await db.query(
    `SELECT
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.previous_info_formid_hex,
       dn.speaker_formid_hex,
       dn.speaker_name,
       s.id AS string_id,
       s.text_raw AS source,
       s.context,
       t.id AS translation_id,
       t.text AS translation,
       t.status,
       t.confidence,
       t.provenance,
       t.model,
       t.updated_at,
       COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM dialog_nodes dn
     LEFT JOIN strings s
       ON s.id = dn.response_string_id
      AND s.lang = $2
     LEFT JOIN translations t
       ON t.src_string_id = s.id
      AND t.target_lang = $3
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $3
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
        LIMIT 1
      )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id
         AND qi.target_lang = $3
         AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE dn.topic_id = $1
     ORDER BY dn.id ASC`,
    [topicId, srcLang, targetLang],
  );

  const { rows: edgeRows } = await db.query(
    `SELECT
       de.id AS edge_id,
       de.from_info_formid_hex,
       de.to_info_formid_hex,
       de.edge_kind,
       de.confidence
     FROM dialog_edges de
     WHERE de.topic_id = $1
     ORDER BY de.id ASC`,
    [topicId],
  );

  return {
    nodes: nodeRows as DialogTreeNodeRow[],
    edges: edgeRows as DialogTreeEdgeRow[],
  };
};

// ── Scene-based dialog queries ──────────────────────────────────────────────

export type DialogSceneRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  quest_formid_hex: string | null;
  phase_count: number;
};

export type DialogConversationRow = {
  conversation_key: string;
  quest_formid_hex: string | null;
  sample_scene_edid: string | null;
  sample_scene_formid_hex: string;
  scene_count: number;
  phase_count: number;
};

/**
 * List all dialog scenes for a mod, ordered by phase count descending.
 */
export const listDialogScenes = async (db: Tx, modId: number): Promise<DialogSceneRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       ds.quest_formid_hex,
       COUNT(dsp.id)::int AS phase_count
     FROM dialog_scenes ds
     LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     WHERE ds.mod_id = $1
     GROUP BY ds.id, ds.formid_hex, ds.edid, ds.quest_formid_hex
     ORDER BY phase_count DESC, ds.formid_hex ASC`,
    [modId],
  );
  return rows as DialogSceneRow[];
};

/**
 * List aggregated conversation groups.
 *
 * A conversation groups all scenes that belong to the same quest. Scenes
 * without a quest owner become single-scene conversations keyed by their
 * own FormID.
 */
export const listDialogConversations = async (
  db: Tx,
  modId: number,
): Promise<DialogConversationRow[]> => {
  const { rows } = await db.query(
    `SELECT
       COALESCE(ds.quest_formid_hex, ds.formid_hex) AS conversation_key,
       MIN(ds.quest_formid_hex) AS quest_formid_hex,
       MIN(ds.edid) AS sample_scene_edid,
       MIN(ds.formid_hex) AS sample_scene_formid_hex,
       COUNT(DISTINCT ds.id)::int AS scene_count,
       COUNT(dsp.id)::int AS phase_count
     FROM dialog_scenes ds
     LEFT JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     WHERE ds.mod_id = $1
     GROUP BY COALESCE(ds.quest_formid_hex, ds.formid_hex)
     ORDER BY phase_count DESC, scene_count DESC, conversation_key ASC`,
    [modId],
  );
  return rows as DialogConversationRow[];
};

export type SceneDialogLineRow = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  phase_order: number;
  alias_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_id: number | null;
  info_formid_hex: string | null;
  speaker_name: string | null;
  string_id: number | null;
  source: string | null;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  qa_issue_count: number;
};

/**
 * Load the full dialog content for a scene, returning phase-ordered lines
 * with speaker info and translation data.
 *
 * Joins scene phases → topics → nodes → strings → translations to produce
 * a flat sortable result that the UI can render as a conversation.
 */
export const getSceneDialog = async (
  db: Tx,
  sceneId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<SceneDialogLineRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       dsp.phase_order,
       dsp.alias_id,
       dt.formid_hex AS topic_formid_hex,
       dt.edid AS topic_edid,
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.speaker_name,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.text AS translation,
       t.status,
       COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM dialog_scene_phases dsp
     JOIN dialog_scenes ds ON ds.id = dsp.scene_id
     JOIN dialog_topics dt ON dt.id = dsp.topic_id
     LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
     LEFT JOIN strings s
       ON s.id = dn.response_string_id
      AND s.lang = $2
     LEFT JOIN translations t
       ON t.src_string_id = s.id
      AND t.target_lang = $3
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $3
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
        LIMIT 1
      )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id
         AND qi.target_lang = $3
         AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE dsp.scene_id = $1
     ORDER BY dsp.phase_order ASC, dn.id ASC`,
    [sceneId, srcLang, targetLang],
  );
  return rows as SceneDialogLineRow[];
};

/**
 * Load a stitched conversation stream by grouping all scenes that belong to
 * the same quest. Scene order falls back to dialog_scenes.id which preserves
 * import order from the plugin walk.
 */
export const getConversationDialog = async (
  db: Tx,
  modId: number,
  conversationKey: string,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<SceneDialogLineRow[]> => {
  const { rows } = await db.query(
    `SELECT
       ds.id AS scene_id,
       ds.formid_hex AS scene_formid_hex,
       ds.edid AS scene_edid,
       dsp.phase_order,
       dsp.alias_id,
       dt.formid_hex AS topic_formid_hex,
       dt.edid AS topic_edid,
       dn.id AS node_id,
       dn.info_formid_hex,
       dn.speaker_name,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.text AS translation,
       t.status,
       COALESCE(q.issue_count, 0) AS qa_issue_count
     FROM dialog_scenes ds
     JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
     JOIN dialog_topics dt ON dt.id = dsp.topic_id
     LEFT JOIN dialog_nodes dn ON dn.topic_id = dt.id
     LEFT JOIN strings s
       ON s.id = dn.response_string_id
      AND s.lang = $3
     LEFT JOIN translations t
       ON t.src_string_id = s.id
      AND t.target_lang = $4
      AND t.id = (
        SELECT id FROM translations
        WHERE src_string_id = s.id AND target_lang = $4
        ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
        LIMIT 1
      )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id
         AND qi.target_lang = $4
         AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE ds.mod_id = $1
       AND COALESCE(ds.quest_formid_hex, ds.formid_hex) = $2
     ORDER BY ds.id ASC, dsp.phase_order ASC, dn.id ASC`,
    [modId, conversationKey, srcLang, targetLang],
  );
  return rows as SceneDialogLineRow[];
};

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
};

/**
 * Editor "RAG examples" panel: retrieve reference translations for a source
 * string using the same RAG hybrid retrieval (TM-style + vector similarity)
 * that powers LLM auto-translation. This replaces the legacy standalone TM
 * suggestion query so the panel and the LLM share one source of truth.
 *
 * Only `reviewed` translations are eligible (the RAG index). Returns
 * an empty list when RAG is unavailable (e.g. pgvector missing) so the panel
 * degrades gracefully instead of erroring.
 */
export const getRagSuggestions = async (
  db: Tx,
  stringId: number,
  targetLang: string,
  limit = 10,
): Promise<RagReferenceExample[]> => {
  const { rows } = await db.query<{
    text_raw: string;
    text_norm: string | null;
    text_norm_nopunct: string | null;
    lang: string;
    context: string | null;
    signature: string | null;
    path: string | null;
  }>(
    `SELECT s.text_raw, s.text_norm, s.text_norm_nopunct, s.lang, s.context,
            r.signature, r.path
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE s.id = $1`,
    [stringId],
  );
  const row = rows[0];
  if (!row?.text_raw) return [];

  try {
    return await findReferenceExamples(db, {
      stringId,
      sourceText: row.text_raw,
      textNorm: row.text_norm,
      textNormNopunct: row.text_norm_nopunct,
      signature: row.signature,
      path: row.path,
      context: row.context,
      srcLang: row.lang,
      targetLang,
      maxExamples: limit,
    });
  } catch (err) {
    log.warn(`RAG suggestions unavailable for string ${stringId}: ${(err as Error).message}`);
    return [];
  }
};

// ── Translations ──────────────────────────────────────────────────────────────

export const upsertTranslation = async (
  db: Tx,
  stringId: number,
  text: string,
  status: Exclude<TranslationStatus, 'deleted'>,
  targetLang = CONFIG.defaultTgtLang,
  provenance?: string,
  model?: string,
  /** ID of the user who saved this translation. Null for automated pipelines. */
  userId: number | null = null,
) => {
  if (status === 'skip') {
    await markStringsAsSkip(db, [stringId]);
    return { id: stringId, text: '', status: 'skip' as const };
  }

  const effectiveProvenance =
    provenance ??
    (status === 'draft' || status === 'reviewed' || status === 'rejected' || status === 'human'
      ? 'human_edit'
      : `${status}_generated`);

  await db.query(`DELETE FROM translations WHERE src_string_id = $1 AND target_lang = $2`, [
    stringId,
    targetLang,
  ]);

  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, user_id, updated_at)
     VALUES ($1, $2, $3, $4, 1.0, $5, $6, NOW())
     RETURNING id`,
    [stringId, targetLang, text, status, effectiveProvenance, userId],
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

  scheduleRagSync(db, translationId);

  return { id: translationId, text, status };
};

/**
 * Keep only string IDs that LLM batch translate may process: not marked skip
 * (`is_ignored`) and eligible under {@link llmTranslateEligibilitySql}.
 */
export const filterStringIdsForLlmTranslate = async (
  db: Tx,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
  overwriteMode: LlmTranslateOverwriteMode = 'default',
): Promise<number[]> => {
  if (stringIds.length === 0) return [];
  const { rows } = await db.query<{ id: number }>(
    `SELECT s.id
       FROM strings s
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $2
      WHERE s.id = ANY($1::int[])
        AND s.is_ignored = FALSE
        AND ${llmTranslateEligibilitySql(overwriteMode)}`,
    [stringIds, targetLang],
  );
  return rows.map((r) => r.id);
};

export const deleteTranslation = async (
  db: Tx,
  stringId: number,
  targetLang = CONFIG.defaultTgtLang,
) => {
  const { rows } = await db.query<{
    id: number;
    text: string;
    provenance: string | null;
    model: string | null;
  }>(
    `SELECT id, text, provenance, model
       FROM translations
      WHERE src_string_id = $1 AND target_lang = $2`,
    [stringId, targetLang],
  );

  for (const row of rows) {
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

  if (rows.length > 0) {
    await db.query(`DELETE FROM translations WHERE src_string_id = $1 AND target_lang = $2`, [
      stringId,
      targetLang,
    ]);
  }

  await db.query(`DELETE FROM qa_issues WHERE src_string_id = $1 AND target_lang = $2`, [
    stringId,
    targetLang,
  ]);

  return { removed: rows.length };
};

/** Archive revisions, drop translations, and drop QA rows — three statements, no per-row work. */
const clearTranslationsInTransaction = async (
  client: pg.PoolClient,
  targetLang: string,
  targetStringsSql: string,
  values: unknown[],
): Promise<number> => {
  const { rowCount } = await client.query(
    `INSERT INTO translation_revisions(
       src_string_id, translation_id, target_lang, text, status, provenance, model, note
     )
     SELECT t.src_string_id, t.id, t.target_lang, t.text, 'deleted', t.provenance, t.model, 'clear'
       FROM translations t
      WHERE t.target_lang = $1
        AND t.src_string_id IN (${targetStringsSql})`,
    values,
  );
  await client.query(
    `DELETE FROM translations t
      WHERE t.target_lang = $1
        AND t.src_string_id IN (${targetStringsSql})`,
    values,
  );
  await client.query(
    `DELETE FROM qa_issues qi
      WHERE qi.target_lang = $1
        AND qi.src_string_id IN (${targetStringsSql})`,
    values,
  );
  return rowCount ?? 0;
};

/** Remove target-language translations for many source strings at once. */
export const deleteTranslationsBatch = async (
  db: Tx,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ removed: number }> => {
  if (stringIds.length === 0) return { removed: 0 };

  const removed = await withTransaction(db as pg.Pool, async (client) =>
    clearTranslationsInTransaction(client, targetLang, 'SELECT unnest($2::int[])', [
      targetLang,
      stringIds,
    ]),
  );
  return { removed };
};

/** Shift $1, $2, … placeholders in SQL fragments (used when prepending a bound param). */
const bumpSqlParams = (sql: string, by = 1): string =>
  sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + by}`);

/**
 * Remove target-language translations for every string matching an editor filter.
 * Avoids fetching the full ID list to the client first.
 */
export const deleteTranslationsByFilter = async (
  db: Tx,
  f: StringsFilter,
  excludeIds: number[] = [],
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ removed: number }> => {
  const srcLang = f.srcLang ?? CONFIG.defaultSrcLang;
  const { conditions, values, idx } = buildStringFilterConditions(f);
  // clearTranslationsInTransaction binds targetLang as $1; filter params follow from $2.
  const where = bumpSqlParams(conditions.join(' AND '));
  const targetLangIdx = idx + 1;
  const srcLangIdx = idx + 2;
  const queryValues: unknown[] = [targetLang, ...values, targetLang, srcLang];

  let excludeIdx: number | null = null;
  if (excludeIds.length > 0) {
    excludeIdx = srcLangIdx + 1;
    queryValues.push(excludeIds);
  }

  const qaExists = `EXISTS (SELECT 1 FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${targetLangIdx} AND qi.is_active = TRUE)`;
  const excludeClause = excludeIdx != null ? ` AND s.id <> ALL($${excludeIdx}::int[])` : '';

  const targetStringsSql = `SELECT s.id
       FROM strings s
       JOIN records r ON s.record_id = r.id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
      WHERE s.lang = $${srcLangIdx} AND ${where}${f.qaOnly ? ` AND ${qaExists}` : ''}${excludeClause}`;

  const removed = await withTransaction(db as pg.Pool, async (client) =>
    clearTranslationsInTransaction(client, targetLang, targetStringsSql, queryValues),
  );
  return { removed };
};

/**
 * Remove target-language translations where trimmed text equals trimmed source.
 * Used to clean up accidental copy-source / untranslated rows across a mod.
 */
export const clearSameAsSourceTranslations = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<{ cleared: number }> => {
  const { rows } = await db.query<{
    string_id: number;
    translation_id: number;
    text: string;
    provenance: string | null;
    model: string | null;
  }>(
    `SELECT s.id AS string_id, t.id AS translation_id, t.text, t.provenance, t.model
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND trim(s.text_raw) = trim(t.text)
        AND length(trim(s.text_raw)) > 0`,
    [modId, srcLang, targetLang],
  );

  if (rows.length === 0) return { cleared: 0 };

  const stringIds = rows.map((row) => row.string_id);

  await withTransaction(db as pg.Pool, async (client) => {
    for (const row of rows) {
      await recordTranslationRevision(client, {
        stringId: row.string_id,
        translationId: row.translation_id,
        targetLang,
        text: row.text,
        status: 'deleted',
        provenance: row.provenance,
        model: row.model,
        note: 'clear_same_as_source',
      });
    }
    await client.query(
      `DELETE FROM translations
        WHERE target_lang = $1
          AND src_string_id = ANY($2::int[])`,
      [targetLang, stringIds],
    );
    await client.query(
      `DELETE FROM qa_issues
        WHERE target_lang = $1
          AND src_string_id = ANY($2::int[])`,
      [targetLang, stringIds],
    );
  });

  return { cleared: rows.length };
};

/** Remove every translation row (all target languages) for one source string. */
export const deleteAllTranslationsForString = async (db: Tx, stringId: number): Promise<number> => {
  const { rows } = await db.query<{
    id: number;
    target_lang: string;
    text: string;
    provenance: string | null;
    model: string | null;
  }>(
    `SELECT id, target_lang, text, provenance, model
       FROM translations
      WHERE src_string_id = $1`,
    [stringId],
  );

  for (const row of rows) {
    await recordTranslationRevision(db, {
      stringId,
      translationId: row.id,
      targetLang: row.target_lang,
      text: row.text,
      status: 'deleted',
      provenance: row.provenance,
      model: row.model,
      note: 'clear',
    });
  }

  if (rows.length > 0) {
    await db.query(`DELETE FROM translations WHERE src_string_id = $1`, [stringId]);
  }

  await db.query(`DELETE FROM qa_issues WHERE src_string_id = $1`, [stringId]);

  return rows.length;
};

/**
 * Mark source string(s) as non-translatable.
 *
 * The `is_ignored` flag is the single source of truth for the "skip" status
 * (listStrings derives `status = 'skip'` from it, stats count it as skipped,
 * and the status filter maps `skip` → `is_ignored = TRUE`). A non-translatable
 * string must not carry any translation rows, so all existing translations
 * (every target language) are deleted here. Export still emits the source text
 * via `COALESCE(t.text, s.text_raw)` once translations are gone.
 *
 */
export const markStringsAsSkip = async (db: Tx, stringIds: number[]): Promise<number> => {
  if (stringIds.length === 0) return 0;

  const { rows } = await db.query<{ id: number }>(
    `UPDATE strings SET is_ignored = TRUE
      WHERE id = ANY($1::int[])
        AND is_ignored = FALSE
      RETURNING id`,
    [stringIds],
  );

  const markedIds = rows.map((row) => row.id);
  if (markedIds.length === 0) return 0;

  if (markedIds.length === 1) {
    await deleteAllTranslationsForString(db, markedIds[0]!);
    return 1;
  }

  await db.query(`DELETE FROM translations WHERE src_string_id = ANY($1::int[])`, [markedIds]);
  await db.query(`DELETE FROM qa_issues WHERE src_string_id = ANY($1::int[])`, [markedIds]);

  return markedIds.length;
};

/** Clear skip flags and audit timestamps for a mod before a force re-scan. */
export const resetModSkipDetectState = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<{ resetCount: number; clearedSkips: number }> => {
  const { rows: before } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = TRUE`,
    [modId, srcLang],
  );
  const clearedSkips = Number.parseInt(before[0]?.cnt ?? '0', 10);

  const { rowCount } = await db.query(
    `UPDATE strings s
        SET is_ignored = FALSE,
            skip_detect_scanned_at = NULL
       FROM records r
      WHERE r.id = s.record_id
        AND r.mod_id = $1
        AND s.lang = $2`,
    [modId, srcLang],
  );

  return { resetCount: rowCount ?? 0, clearedSkips };
};

/** Clear the global skip flag so the string(s) can be translated again. */
export const unmarkStringsSkip = async (db: Tx, stringIds: number[]): Promise<number> => {
  if (stringIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE strings SET is_ignored = FALSE WHERE id = ANY($1::int[])`,
    [stringIds],
  );
  return rowCount ?? 0;
};

/** Record that skip-detect has audited these source strings (keep or skip verdict). */
export const markStringsSkipDetectScanned = async (
  db: Tx,
  stringIds: number[],
): Promise<number> => {
  if (stringIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE strings
        SET skip_detect_scanned_at = NOW()
      WHERE id = ANY($1::int[])`,
    [stringIds],
  );
  return rowCount ?? 0;
};

/**
 * Promote machine/draft translations of the given source strings to 'reviewed'
 * for a target language. Used by the verification auto-approve flow: a string
 * that passed LLM verification with no issues is confirmed automatically.
 *
 * Manually-decided statuses ('human', 'reviewed', 'rejected', 'skip') are left
 * untouched so auto-approve never overrides a human decision.
 *
 * @returns Number of translation rows promoted to 'reviewed'.
 */
export const approveVerifiedTranslations = async (
  db: Tx,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
): Promise<number> => {
  if (stringIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE translations
        SET status = 'reviewed', updated_at = NOW()
      WHERE target_lang = $2
        AND src_string_id = ANY($1::int[])
        AND status IN ('draft', 'tm', 'fuzzy', 'auto')`,
    [stringIds, targetLang],
  );
  return rowCount ?? 0;
};

// Returns text_norm for a string ID (used by propagation)
export const getStringTextNorm = async (db: Tx, stringId: number): Promise<string | null> => {
  const { rows } = await db.query(`SELECT text_norm FROM strings WHERE id = $1`, [stringId]);
  return rows[0]?.text_norm ?? null;
};

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
  opts?: {
    onProgress?: (
      processed: number,
      total: number,
      stats: { applied: number; skipped: number; unmatched: number; empty: number },
    ) => void | Promise<void>;
    shouldCancel?: () => boolean;
  },
): Promise<{
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
  cancelled?: boolean;
}> => {
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
    opts?.onProgress,
    opts?.shouldCancel,
  );
};

/** DB write and progress report interval (rows) for apply-imported translation copy. */
export const APPLY_IMPORTED_BATCH_SIZE = 500;

/** Count target mod source strings eligible for imported translation apply. */
export const countApplyImportedTargetStrings = async (
  db: Tx,
  targetModId: number,
  srcLang: string,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON s.record_id = r.id
      WHERE r.mod_id = $1 AND s.lang = $2 AND s.is_ignored = FALSE`,
    [targetModId, srcLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
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
  onProgress?: (
    processed: number,
    total: number,
    stats: { applied: number; skipped: number; unmatched: number; empty: number },
  ) => void | Promise<void>,
  shouldCancel?: () => boolean,
): Promise<{
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
  cancelled?: boolean;
}> => {
  /**
   * Normalize record paths so equivalent notations compare reliably.
   * Example: "INFO\\FULL" and "info/full" become the same lookup key.
   */
  const normalizePath = (value: string | null | undefined): string =>
    (value ?? '').trim().replace(/\\+/g, '/').replace(/\/+/g, '/').toLowerCase();

  /**
   * Normalize FormID as uppercase stable identity text.
   */
  const normalizeFormId = (value: string | null | undefined): string =>
    (value ?? '').trim().toUpperCase();

  /**
   * Normalize EDID to case-insensitive match key.
   */
  const normalizeEdid = (value: string | null | undefined): string =>
    (value ?? '').trim().toLowerCase();

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
     WHERE r.mod_id = $1 AND s.lang = $2 AND s.is_ignored = FALSE`,
    [targetModId, srcLang],
  );

  if (targetRows.length === 0) {
    throw new Error(`Target mod has no source strings for lang "${srcLang}"`);
  }

  // Build lookup maps for a strict-to-loose cascade: strict identity first,
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

  // Step 4: Upsert translations by identity match in batches.
  let applied = 0;
  let skipped = 0;
  let unmatched = 0;
  let empty = 0;
  let processed = 0;
  let pendingApplies: BulkTranslationRow[] = [];
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
   * matching cascade.
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

    const directChecks: Array<{
      method: keyof typeof matchCounters;
      key: string;
      map: Map<string, string | null>;
    }> = [
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

    // Fallback for duplicate keys: when identity is ambiguous,
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

  const flushPendingApplies = async (): Promise<void> => {
    if (pendingApplies.length === 0) return;
    const flushed = await bulkUpsertImportTranslations(
      db,
      pendingApplies,
      targetLang,
      provenance,
      APPLY_IMPORTED_BATCH_SIZE,
      'draft',
    );
    applied += flushed;
    pendingApplies = [];
  };

  const reportProgress = async () => {
    if (
      onProgress &&
      (processed % APPLY_IMPORTED_BATCH_SIZE === 0 ||
        processed === targetRows.length ||
        shouldCancel?.())
    ) {
      await onProgress(processed, targetRows.length, { applied, skipped, unmatched, empty });
    }
  };

  for (const row of targetRows as Array<{
    string_id: number;
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    identity_rank: number;
  }>) {
    if (shouldCancel?.()) {
      await flushPendingApplies();
      break;
    }

    if (alreadyTranslated.has(row.string_id)) {
      skipped += 1;
      processed += 1;
      await reportProgress();
      continue;
    }

    const candidate = resolveImportedCandidate(row);
    if (candidate == null) {
      unmatched += 1;
      processed += 1;
      await reportProgress();
      continue;
    }

    const text = candidate.text.trim();
    if (!text) {
      empty += 1;
      processed += 1;
      await reportProgress();
      continue;
    }

    matchCounters[candidate.method] += 1;

    pendingApplies.push({ srcStringId: row.string_id, text });
    if (pendingApplies.length >= APPLY_IMPORTED_BATCH_SIZE) {
      await flushPendingApplies();
    }
    processed += 1;
    await reportProgress();
  }

  await flushPendingApplies();

  const cancelled = shouldCancel?.() === true && processed < targetRows.length;

  if (onProgress && processed !== targetRows.length && !cancelled) {
    await onProgress(targetRows.length, targetRows.length, { applied, skipped, unmatched, empty });
  }

  log.info(
    `${logLabel}, srcLang=${srcLang}, importedLang=${importedLang}, targetLang=${targetLang}, ` +
      `applied=${applied}, skipped=${skipped}, unmatched=${unmatched}, empty=${empty}, ` +
      `methods=${JSON.stringify(matchCounters)}${cancelled ? ', cancelled=true' : ''}`,
  );

  return { applied, skipped, unmatched, empty, ...(cancelled ? { cancelled: true } : {}) };
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
        await client.query(`UPDATE translations SET text = $1, updated_at = NOW() WHERE id = $2`, [
          m.newText,
          m.translationId,
        ]);
        const { rows: updatedRows } = await client.query(
          `SELECT src_string_id, target_lang, status, provenance, model
           FROM translations WHERE id = $1`,
          [m.translationId],
        );
        const updated = updatedRows[0] as
          | {
              src_string_id: number;
              target_lang: string;
              status: TranslationStatus;
              provenance: string | null;
              model: string | null;
            }
          | undefined;
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
};

// ── Stats ─────────────────────────────────────────────────────────────────────

export const getModStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
) => {
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
      COUNT(DISTINCT CASE WHEN s.is_ignored THEN s.id END) AS skipped,
      COUNT(DISTINCT CASE WHEN t.id IS NULL AND NOT s.is_ignored THEN s.id END) AS untranslated
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1 AND s.lang = $3`,
    [modId, targetLang, srcLang],
  );
  return rows[0];
};

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
): Promise<
  Array<{
    signature: string;
    total: number;
    translated: number;
    approved: number;
    draft: number;
    tm: number;
    auto: number;
  }>
> => {
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

export const getTranslationHistory = async (
  db: Tx,
  stringId: number,
  targetLang = CONFIG.defaultTgtLang,
) => {
  const { rows } = await db.query(
    `SELECT id, translation_id, text, status, provenance, model, note, created_at
     FROM translation_revisions
     WHERE src_string_id = $1 AND target_lang = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 25`,
    [stringId, targetLang],
  );
  return rows;
};

export const getQAIssues = async (db: Tx, stringId: number, targetLang = CONFIG.defaultTgtLang) => {
  const { rows } = await db.query(
    `SELECT id, issue_type, severity, message, updated_at
     FROM qa_issues
     WHERE src_string_id = $1 AND target_lang = $2 AND is_active = TRUE
     ORDER BY CASE severity WHEN 'error' THEN 1 ELSE 2 END, updated_at DESC, id DESC`,
    [stringId, targetLang],
  );
  return rows;
};

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
    WHERE t.text IS NOT NULL AND t.text <> ''
      AND s.is_ignored = FALSE
      AND t.status IN ${PENDING_REVIEW_STATUS_SQL}`;

  const params: unknown[] = [targetLang];
  if (opts.modId) {
    stringsSQL += ` AND r.mod_id = $2`;
    params.push(opts.modId);
  }

  const { rows: strings } = await db.query(stringsSQL, params);

  /* ── 4. Build word-boundary checks and scan every string ───────────── */
  const checks = (glossaryTerms as Array<{ term: string; translation: string }>).map((g) => ({
    tgtNeedle: g.translation.toLowerCase(),
    term: g.term,
    translation: g.translation,
  }));

  let violations = 0;
  const insertValues: unknown[][] = [];

  for (const row of strings as Array<{
    string_id: number;
    source: string;
    translation_id: number;
    translation: string;
  }>) {
    const tgtLower = row.translation.toLowerCase();
    for (const c of checks) {
      if (glossaryTermMatchesSource(row.source, c.term) && !tgtLower.includes(c.tgtNeedle)) {
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
};

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
    normRows.map((r) => [
      r.text_norm,
      { source_text: r.source_text, variant_count: Number(r.variant_count) },
    ]),
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

/**
 * Auto-resolves all coherence inconsistencies for a target language by
 * applying the plurality-winner translation to every inconsistent group.
 *
 * Winner selection per group:
 * 1. Usage count — the translation currently used by the most strings wins.
 * 2. Status quality — human > reviewed > tm > fuzzy > auto > draft, as a tie-breaker.
 * 3. Alphabetical order — for determinism when count and quality are tied.
 *
 * @param db         - Database pool (each group's writes use its own internal transaction).
 * @param targetLang - Target language code to resolve (e.g. 'uk').
 * @param srcLang    - Source language code (default: CONFIG.defaultSrcLang).
 * @returns          - Number of groups resolved and total strings updated.
 */
export const resolveAllCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ resolved: number; updated: number }> => {
  // Inline status weight expression reused in both DISTINCT ON order and
  // aggregate quality computation.
  const statusWeight = `CASE status WHEN 'human' THEN 6 WHEN 'reviewed' THEN 5 WHEN 'tm' THEN 4 WHEN 'fuzzy' THEN 3 WHEN 'auto' THEN 2 ELSE 1 END`;

  // Find the plurality winner for every inconsistent text_norm in one query:
  //   bt            — best translation per string (mirrors the CTE used elsewhere)
  //   group_variants — usage count + max quality per (text_norm, translation) pair
  //   conflicted    — text_norms that have more than one distinct translation variant
  //   page_winners  — DISTINCT ON picks best translation per group by count → quality → text
  const { rows: winners } = await db.query<{ text_norm: string; translation: string }>(
    `WITH bt AS (
       SELECT DISTINCT ON (src_string_id)
         src_string_id,
         text                  AS translation,
         ${statusWeight}       AS quality
       FROM translations
       WHERE target_lang = $1
       ORDER BY src_string_id,
         ${statusWeight} DESC,
         COALESCE(confidence, 0) DESC,
         updated_at DESC
     ),
     group_variants AS (
       SELECT s.text_norm,
              bt.translation,
              COUNT(*)::int      AS usage_count,
              MAX(bt.quality)::int AS best_quality
       FROM strings s
       JOIN bt ON bt.src_string_id = s.id
       WHERE s.lang = $2
         AND s.text_norm IS NOT NULL
         AND s.text_norm <> ''
       GROUP BY s.text_norm, bt.translation
     ),
     conflicted AS (
       SELECT text_norm
       FROM group_variants
       GROUP BY text_norm
       HAVING COUNT(DISTINCT translation) > 1
     ),
     page_winners AS (
       SELECT DISTINCT ON (gv.text_norm)
         gv.text_norm,
         gv.translation
       FROM group_variants gv
       JOIN conflicted c ON c.text_norm = gv.text_norm
       ORDER BY gv.text_norm, gv.usage_count DESC, gv.best_quality DESC, gv.translation
     )
     SELECT text_norm, translation FROM page_winners`,
    [targetLang, srcLang],
  );

  let totalUpdated = 0;
  for (const winner of winners) {
    const result = await resolveCoherenceGroup(
      db,
      winner.text_norm,
      targetLang,
      winner.translation,
    );
    totalUpdated += result.updated;
  }
  log.info(
    `resolve-all coherence: targetLang=${targetLang} resolved=${winners.length} updated=${totalUpdated}`,
  );
  return { resolved: winners.length, updated: totalUpdated };
};

/**
 * Returns the IDs of every source string matching the given filter, applying
 * exactly the same predicates as {@link listStrings} (status, signature,
 * per-column filters, QA-only) — but without pagination.
 *
 * Used by the editor's "select all matching" feature so bulk actions can target
 * the full filtered set without shipping a huge ID list back and forth.
 */
export const listMatchingStringIds = async (db: Tx, f: StringsFilter): Promise<number[]> => {
  const srcLang = f.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = f.targetLang ?? CONFIG.defaultTgtLang;

  const { conditions, values, idx } = buildStringFilterConditions(f);
  const where = conditions.join(' AND ');

  const targetLangIdx = idx;
  const srcLangIdx = idx + 1;
  const allValues = [...values, targetLang, srcLang];

  const qaExists = `EXISTS (SELECT 1 FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $${targetLangIdx} AND qi.is_active = TRUE)`;

  const { rows } = await db.query(
    `SELECT s.id AS string_id
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $${targetLangIdx}
     WHERE s.lang = $${srcLangIdx} AND ${where}${f.qaOnly ? ` AND ${qaExists}` : ''}`,
    allValues,
  );

  return (rows as Array<{ string_id: number }>).map((r) => r.string_id);
};

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
