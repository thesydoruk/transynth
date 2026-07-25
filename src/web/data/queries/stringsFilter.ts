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

export const statusFilterNeedsTranslationJoin = (statuses: string[]): boolean => {
  if (statuses.length === 0) return false;
  const onlySkip = statuses.every((s) => s === 'skip');
  const onlyUntranslated = statuses.length === 1 && statuses[0] === 'untranslated';
  return !onlySkip && !onlyUntranslated;
};

/** Status / QA filters only — no column text predicates. */
export const isStatusOnlyStringsFilter = (
  f: Pick<
    StringsFilter,
    'qaOnly' | 'query' | 'grup' | 'formid' | 'edid' | 'field' | 'src' | 'transl' | 'hideIgnored'
  >,
): boolean =>
  !f.qaOnly &&
  !f.query &&
  !f.grup &&
  !f.formid &&
  !f.edid &&
  !f.field &&
  !f.src &&
  !f.transl &&
  !f.hideIgnored;

/** Whitelist mapping from client-facing sort key to SQL column expression. */
export const SORT_COLUMNS: Record<string, string> = {
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
export const buildStringFilterConditions = (
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
