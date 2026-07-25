import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { computeSignatureCounts, computeStatusTotal } from '../../services/modLangStats';
import {
  type StringsFilter,
  parseStatusFilter,
  buildStringFilterConditions,
  statusFilterNeedsTranslationJoin,
  isStatusOnlyStringsFilter,
  SORT_COLUMNS,
} from './stringsFilter';

export type { StringsFilter } from './stringsFilter';
export { parseStatusFilter } from './stringsFilter';

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
  const statuses = parseStatusFilter(f.status);
  const useLiveStatusTotal =
    page === 1 && isStatusOnlyStringsFilter(f) && statuses.length > 0;
  const liveStatusTotal = useLiveStatusTotal
    ? await computeStatusTotal(db, f.modId, srcLang, targetLang, statuses)
    : null;

  const [pageResult, countResult] = await Promise.all([
    db.query(pageSql, allValues),
    countQuery && liveStatusTotal === null
      ? db.query(countQuery.sql, countQuery.values)
      : Promise.resolve(null),
  ]);
  const rows = pageResult.rows;
  const total =
    liveStatusTotal !== null ? liveStatusTotal : countResult ? Number(countResult.rows[0].total) : 0;

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

  if (isStatusOnlyStringsFilter(f) && statuses.length > 0) {
    return computeSignatureCounts(db, f.modId, srcLang, targetLang, statuses);
  }

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
