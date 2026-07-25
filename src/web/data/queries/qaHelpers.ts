import type { Tx } from '../../../db';
import type { GameType } from '../../../types';
import { CONFIG } from '../../../config';
import type { TranslationStatus } from '../statusMachine';
import { compareProtectedTokens } from '../../../utils/placeholders';
import { parseRecordLocation } from '../../../utils/recordLocation';
import { glossaryTermMatchesSource } from './glossaryHelpers';
import { applyGenderQaIssues } from './qaGender';
import type { DialogParticipantsRow } from './dialogs';
import { PENDING_REVIEW_STATUSES } from './constants';

export type QAIssueInput = {
  issueType: string;
  severity: 'warning' | 'error';
  message: string;
};

/**
 * Escape special regex metacharacters in a string so it can be used
 * inside a `new RegExp(...)` as a literal match.
 */

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

export type QaRuleRow = {
  rule_type: string;
  value: string;
  severity: string;
  description: string | null;
  rule_sig: string | null;
  rule_path: string | null;
};

export const qaRuleGameKey = (game: string | null | undefined): string =>
  game === 'fo76' ? 'fo4' : (game ?? 'fo4');

export const loadQaCheckSettings = async (db: Tx): Promise<QACheckSettings> => {
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

export const loadGlossaryTermsForQa = async (
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

export const loadQaRulesForGame = async (db: Tx, game: string): Promise<QaRuleRow[]> => {
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

export type QaTranslationContextRow = Partial<DialogParticipantsRow> & {
  source: string;
  is_ignored?: boolean;
  translation_id?: number | null;
  translation?: string | null;
  translation_status?: TranslationStatus | null;
  signature?: string | null;
  path?: string | null;
  game?: string;
};

/** Everything a QA batch loads once and reuses for every row in it. */
export type QaBatchContext = {
  targetLang: string;
  settings: QACheckSettings;
  /** Configurable `qa_rules` rows for the game of the row being checked. */
  rules: QaRuleRow[];
  glossaryTerms: Array<{ term: string; translation: string }>;
};

export const collectQAIssuesForRow = (
  row: QaTranslationContextRow,
  ctx: QaBatchContext,
  duplicateAlts: string[],
): QAIssueInput[] => {
  if (!row.source || row.translation == null || row.is_ignored) return [];
  if (row.translation_status && !PENDING_REVIEW_STATUSES.has(row.translation_status)) {
    return [];
  }

  const location = parseRecordLocation(row.signature, row.path);
  const issues = buildQAIssues(
    row.source,
    row.translation,
    row.game as GameType | undefined,
    ctx.settings,
    location,
  );
  applyConfigurableQaRules(issues, row.translation, row.signature, row.path, ctx.rules);
  applyGlossaryQaIssues(issues, row.source, row.translation, ctx.glossaryTerms);
  applyGenderQaIssues(issues, row.translation, ctx.targetLang, row, location.field);
  appendDuplicateInconsistencyIssue(issues, duplicateAlts);
  return issues;
};

export const bulkInsertQAIssues = async (
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
