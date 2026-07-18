import { useMemo } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { api, type StringRow, type StringsResult, type StringFilterParams } from '../../../api';
import { SUPPORTED_CONTENT_LANGUAGES } from '../../../langDefaults';
import { statusParamFromSelection, type StatusFilterValue } from '../statusFilter';
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
  /** Active status filter tokens (empty = all statuses). */
  selectedStatuses: StatusFilterValue[];
  /** When true, only rows with QA issues are shown. */
  qaOnly: boolean;
  /** Active record-signature filter (empty string = all). */
  signature: string;
  /** Per-column text filters for the string grid. */
  columnFilters: ColumnFilters;
  /** Number of rows fetched per infinite-scroll page. */
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
 * single hook.  Callers provide filter / sort state; the hook returns all query
 * data plus derived convenience values (available languages, signature counts,
 * active max-length rule) and the infinite-scroll controls.
 *
 * @param params - Filter, sort and selection state.
 * @returns Query results and derived values.
 */
export function useEditorQueries(params: UseEditorQueriesParams) {
  const {
    modId,
    gameId,
    srcLang,
    targetLang,
    selectedStatuses,
    qaOnly,
    signature,
    columnFilters,
    pageSize,
    sortCol,
    sortDir,
    activeRow,
    activeTab,
  } = params;

  const statusParam = statusParamFromSelection(selectedStatuses);

  const stringFilters: StringFilterParams = {
    srcLang,
    targetLang,
    status: statusParam,
    qaOnly: qaOnly || undefined,
    grup: columnFilters.grup || undefined,
    formid: columnFilters.formid || undefined,
    edid: columnFilters.edid || undefined,
    field: columnFilters.field || undefined,
    src: columnFilters.src || undefined,
    transl: columnFilters.transl || undefined,
  };

  /* ── Query keys ── */
  // Page is intentionally absent: it is the infinite-query page param, not a
  // cache-key dimension (all pages live under one accumulating query entry).
  const stringsKey = [
    'strings',
    modId,
    srcLang,
    targetLang,
    statusParam ?? '',
    qaOnly,
    signature,
    columnFilters.grup,
    columnFilters.formid,
    columnFilters.edid,
    columnFilters.field,
    columnFilters.src,
    columnFilters.transl,
    sortCol,
    sortDir,
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

  /** Aggregate translation statistics for the mod. */
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['stats', modId],
    queryFn: () => api.stats.mod(modId),
  });

  /**
   * String rows matching the current filters, fetched page-by-page and
   * accumulated for virtualised infinite scroll. The grid renders the flattened
   * {@link strings} object below; {@link fetchNextPage} loads the next chunk
   * when the user nears the end of the list.
   */
  const {
    data: stringsPages,
    isLoading,
    isFetched: stringsFetched,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: stringsKey,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.strings.list({
        modId,
        ...stringFilters,
        signature: signature || undefined,
        page: pageParam,
        pageSize,
        sort: sortCol ?? undefined,
        order: sortCol ? sortDir : undefined,
      }),
    getNextPageParam: (lastPage: StringsResult) => {
      if (lastPage.total > 0) {
        return lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined;
      }
      return lastPage.rows.length === lastPage.pageSize ? lastPage.page + 1 : undefined;
    },
    placeholderData: (prev) => prev,
  });

  /** Record-signature counts for the sidebar (after page 1 — avoids parallel full-mod scans). */
  const { data: sigs } = useQuery({
    queryKey: [
      'sigs',
      modId,
      srcLang,
      targetLang,
      statusParam ?? '',
      qaOnly,
      columnFilters.grup,
      columnFilters.formid,
      columnFilters.edid,
      columnFilters.field,
      columnFilters.src,
      columnFilters.transl,
    ],
    queryFn: () => api.strings.signatures(modId, stringFilters),
    enabled: stringsFetched,
  });

  /** Flattened rows + total across all loaded pages (grid-friendly shape). */
  const strings = useMemo(() => {
    if (!stringsPages) return undefined;
    return {
      rows: stringsPages.pages.flatMap((p) => p.rows),
      total: stringsPages.pages[0]?.total ?? 0,
    };
  }, [stringsPages]);

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
    mod,
    strings,
    stats,
    sigs,
    langs,
    suggestions,
    qaIssues,
    history,
    maxLengthRules,
    isLoading,
    refetchStats,
    availLangs,
    sigCounts,
    activeMaxLength,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  };
}
