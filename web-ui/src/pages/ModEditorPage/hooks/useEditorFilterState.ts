import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSrcLang, getTgtLang } from '../../../langDefaults';
import type { SortCol, SortDir, ColumnFilters } from '../components/StringGrid';
import {
  parseStatusParam,
  statusParamFromSelection,
  type StatusFilterValue,
} from '../statusFilter';

export interface UseEditorFilterStateParams {
  modId: number;
  /** Clears row selection when filters change. */
  clearSelection: () => void;
}

/**
 * Filter, sort, and page-mode state for the mod editor strings view.
 * Persists filter intent to localStorage and syncs status / qaOnly to the URL.
 */
export function useEditorFilterState({ modId, clearSelection }: UseEditorFilterStateParams) {
  const [searchParams, setSearchParams] = useSearchParams();

  const storageKey = `editor-intent-${modId}`;
  const storedIntent = (() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as {
        statuses?: string[];
        status?: string;
        qaOnly?: boolean;
        signature?: string;
      } | null;
    } catch {
      return null;
    }
  })();

  const initialStatusParam = searchParams.get('status');
  const initialQaOnly = searchParams.get('qaOnly') === '1' || searchParams.get('qaOnly') === 'true';
  const safeInitialStatuses = (() => {
    const fromUrl = parseStatusParam(initialStatusParam);
    if (fromUrl.length > 0) return fromUrl;
    if (storedIntent?.statuses?.length) {
      return parseStatusParam(storedIntent.statuses.join(','));
    }
    if (storedIntent?.status) {
      return parseStatusParam(storedIntent.status);
    }
    return [];
  })();
  const resolvedQaOnly = searchParams.has('qaOnly')
    ? initialQaOnly
    : (storedIntent?.qaOnly ?? false);
  const initialSignature = searchParams.get('signature') ?? storedIntent?.signature ?? '';

  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [selectedStatuses, setSelectedStatuses] =
    useState<StatusFilterValue[]>(safeInitialStatuses);
  const [qaOnly, setQaOnly] = useState(resolvedQaOnly);
  const [signature, setSignature] = useState(initialSignature);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    grup: '',
    formid: '',
    edid: '',
    field: '',
    src: '',
    transl: '',
  });
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pageMode, setPageMode] = useState<'strings' | 'dialogs'>('strings');

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ statuses: selectedStatuses, qaOnly, signature }),
      );
    } catch {
      // Ignore quota / private-browsing errors
    }
  }, [selectedStatuses, qaOnly, signature, storageKey]);

  useEffect(() => {
    const currentStatus = searchParams.get('status') ?? '';
    const currentQaOnly =
      searchParams.get('qaOnly') === '1' || searchParams.get('qaOnly') === 'true';
    const nextStatus = statusParamFromSelection(selectedStatuses) ?? '';
    if (currentStatus === nextStatus && currentQaOnly === qaOnly) return;
    const next = new URLSearchParams(searchParams);
    if (nextStatus) next.set('status', nextStatus);
    else next.delete('status');
    if (qaOnly) next.set('qaOnly', '1');
    else next.delete('qaOnly');
    setSearchParams(next, { replace: true });
  }, [selectedStatuses, qaOnly, searchParams, setSearchParams]);

  const handleColumnFilterChange = useCallback(
    (col: keyof ColumnFilters, value: string) => {
      setColumnFilters((prev) => ({ ...prev, [col]: value }));
      clearSelection();
    },
    [clearSelection],
  );

  const handleSort = useCallback(
    (col: SortCol) => {
      if (sortCol === col) {
        if (sortDir === 'asc') setSortDir('desc');
        else {
          setSortCol(null);
          setSortDir('asc');
        }
      } else {
        setSortCol(col);
        setSortDir('asc');
      }
      clearSelection();
    },
    [sortCol, sortDir, clearSelection],
  );

  return {
    srcLang,
    setSrcLang,
    targetLang,
    setTargetLang,
    selectedStatuses,
    setSelectedStatuses,
    qaOnly,
    setQaOnly,
    signature,
    setSignature,
    columnFilters,
    sortCol,
    sortDir,
    pageMode,
    setPageMode,
    handleColumnFilterChange,
    handleSort,
  };
}
