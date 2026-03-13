import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type StringRow } from '../../../api';
import { SUPPORTED_CONTENT_LANGUAGES } from '../../../langDefaults';
import type { SortCol, SortDir, ColumnFilters } from '../components/StringGrid';
import type { BottomTab } from '../components/DetailPanel';

/**
 * Parameters accepted by {@link useEditorQueries}.
 */
export interface UseEditorQueriesParams {
  /** Numeric mod identifier. */
  modId: number;
  /** Optional game identifier from route params. */
  gameId: string | undefined;
  /** Source language code (e.g. `"en"`). */
  srcLang: string;
  /** Target language code for translations. */
  targetLang: string;
  /** Active status filter value (`"all"` shows every row). */
  status: string;
  /** When true, only rows with QA issues are shown. */
  qaOnly: boolean;
  /** Active record-signature filter (empty string = all). */
  signature: string;
  /** Per-column text filters for the string grid. */
  columnFilters: ColumnFilters;
  /** Current page number (1-based). */
  page: number;
  /** Number of rows per page. */
  pageSize: number;
  /** Column the grid is currently sorted by (`null` = none). */
  sortCol: SortCol | null;
  /** Sort direction. */
  sortDir: SortDir;
  /** Row currently selected for editing, if any. */
  activeRow: StringRow | null;
  /** Which sub-tab is open in the detail panel. */
  activeTab: BottomTab;
}

/**
 * Consolidates every `useQuery` call needed by the mod-editor page into a
 * single hook.  Callers provide filter / pagination / sort state; the hook
 * returns all query data plus derived convenience values (available languages,
 * signature counts, total pages, active max-length rule).
 *
 * @param params - Filter, pagination, sort and selection state.
 * @returns Query results and derived values.
 */
export function useEditorQueries(params: UseEditorQueriesParams) {
  const {
    modId, gameId, srcLang, targetLang, status, qaOnly, signature,
    columnFilters, page, pageSize, sortCol, sortDir, activeRow, activeTab,
  } = params;

  /* ── Query keys ── */
  const stringsKey = [
    'strings', modId, srcLang, targetLang, status, qaOnly, signature,
    columnFilters.grup, columnFilters.formid, columnFilters.edid,
    columnFilters.field, columnFilters.src, columnFilters.transl,
    page, sortCol, sortDir,
  ];

  /* ── Primary queries ── */

  /** Mod metadata (name, game, etc.). */
  const { data: mod } = useQuery({
    queryKey: ['mods', modId],
    queryFn: () => api.mods.get(modId),
  });

  /** Game identifier used to look up QA rules. Falls back to `"fo4"`. */
  const qaRuleGame = (mod?.game ?? gameId ?? 'fo4').toLowerCase();

  /** Max-length QA rules for the resolved game. */
  const { data: maxLengthRules } = useQuery({
    queryKey: ['qaRules', 'max_length', qaRuleGame],
    queryFn: () => api.qaRules.list({ game: qaRuleGame, ruleType: 'max_length', isActive: 'true' }),
    enabled: Boolean(qaRuleGame),
    staleTime: 60_000,
  });

  /** Language codes available in the mod. */
  const { data: langs } = useQuery({
    queryKey: ['langs', modId],
    queryFn: () => api.mods.langs(modId),
  });

  /** Record-signature counts for the sidebar. */
  const { data: sigs } = useQuery({
    queryKey: ['sigs', modId, srcLang],
    queryFn: () => api.strings.signatures(modId, srcLang),
  });

  /** Aggregate translation statistics for the mod. */
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['stats', modId],
    queryFn: () => api.stats.mod(modId),
  });

  /** Paginated string rows matching the current filters. */
  const { data: strings, isLoading } = useQuery({
    queryKey: stringsKey,
    queryFn: () =>
      api.strings.list({
        modId,
        srcLang,
        targetLang,
        status: status === 'all' ? undefined : status,
        qaOnly: qaOnly || undefined,
        signature: signature || undefined,
        grup: columnFilters.grup || undefined,
        formid: columnFilters.formid || undefined,
        edid: columnFilters.edid || undefined,
        field: columnFilters.field || undefined,
        src: columnFilters.src || undefined,
        transl: columnFilters.transl || undefined,
        page,
        pageSize,
        sort: sortCol ?? undefined,
        order: sortCol ? sortDir : undefined,
      }),
    placeholderData: (prev) => prev,
  });

  /* ── Active-row detail queries ── */

  /** TM / glossary suggestions for the active row (loaded lazily). */
  const { data: suggestions } = useQuery({
    queryKey: ['suggestions', activeRow?.string_id, targetLang],
    queryFn: () => api.strings.suggestions(activeRow!.string_id, targetLang),
    enabled: !!activeRow && activeTab === 'suggestions',
  });

  /** QA issues for the active row (loaded lazily). */
  const { data: qaIssues } = useQuery({
    queryKey: ['qa', activeRow?.string_id, targetLang],
    queryFn: () => api.strings.qa(activeRow!.string_id, targetLang),
    enabled: !!activeRow && activeTab === 'qa',
  });

  /** Translation history for the active row (loaded lazily). */
  const { data: history } = useQuery({
    queryKey: ['history', activeRow?.string_id, targetLang],
    queryFn: () => api.strings.history(activeRow!.string_id, targetLang),
    enabled: !!activeRow && activeTab === 'history',
  });

  /* ── Derived values ── */

  /** Total number of pages based on the current query total. */
  const totalPages = strings ? Math.ceil(strings.total / pageSize) : 1;

  /** Signature-count list, defaulting to an empty array. */
  const sigCounts = sigs ?? [];

  /** Available target / source language codes (built-in + mod-specific). */
  const availLangs = useMemo(() => {
    const base = [...SUPPORTED_CONTENT_LANGUAGES] as string[];
    if (!langs || langs.length === 0) return base;
    for (const code of langs) {
      if (!base.includes(code)) base.push(code);
    }
    return base;
  }, [langs]);

  /**
   * Maximum character length derived from QA rules for the active row.
   * The most restrictive matching rule wins.  `null` when no rule applies.
   */
  const activeMaxLength = useMemo(() => {
    if (!activeRow || !maxLengthRules?.length) return null;
    const limits = maxLengthRules
      .filter((rule) => {
        if (rule.rule_type !== 'max_length') return false;
        if (rule.signature && rule.signature !== activeRow.signature) return false;
        if (rule.path && rule.path !== activeRow.path) return false;
        return true;
      })
      .map((rule) => Number.parseInt(rule.value, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return limits.length === 0 ? null : Math.min(...limits);
  }, [activeRow, maxLengthRules]);

  return {
    mod, strings, stats, sigs, langs,
    suggestions, qaIssues, history,
    maxLengthRules, isLoading, refetchStats,
    availLangs, sigCounts, totalPages, activeMaxLength,
  };
}
