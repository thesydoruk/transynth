import { useState, useCallback } from 'react';
import { api, type StringFilterParams, type StringRow } from '../../../api';
import { statusParamFromSelection, type StatusFilterValue } from '../statusFilter';
import type { ColumnFilters } from '../components/StringGrid';

export interface UseEditorSelectionParams {
  modId: number;
  srcLang: string;
  targetLang: string;
  selectedStatuses: StatusFilterValue[];
  qaOnly: boolean;
  signature: string;
  columnFilters: ColumnFilters;
  /** Loaded grid rows (current infinite-scroll pages). */
  rows: StringRow[] | undefined;
  /** Total rows matching the current filter. */
  total: number;
}

/**
 * Checkbox selection for the string grid, including "select all matching"
 * mode that avoids materialising every filtered ID client-side.
 */
export function useEditorSelection({
  modId,
  srcLang,
  targetLang,
  selectedStatuses,
  qaOnly,
  signature,
  columnFilters,
  rows,
  total,
}: UseEditorSelectionParams) {
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const isRowSelected = useCallback(
    (id: number) => (selectAllMatching ? !selected.has(id) : selected.has(id)),
    [selectAllMatching, selected],
  );

  const selectedCount = selectAllMatching ? Math.max(0, total - selected.size) : selected.size;
  const hasSelection = selectedCount > 0;
  const allSelected = selectAllMatching && selected.size === 0 && total > 0;
  const someSelected = hasSelection && !allSelected;

  const clearSelection = useCallback(() => {
    setSelectAllMatching(false);
    setSelected(new Set());
  }, []);

  const buildFilter = useCallback(
    (): StringFilterParams => ({
      srcLang,
      targetLang,
      status: statusParamFromSelection(selectedStatuses),
      qaOnly: qaOnly || undefined,
      signature: signature || undefined,
      grup: columnFilters.grup || undefined,
      formid: columnFilters.formid || undefined,
      edid: columnFilters.edid || undefined,
      field: columnFilters.field || undefined,
      src: columnFilters.src || undefined,
      transl: columnFilters.transl || undefined,
    }),
    [srcLang, targetLang, selectedStatuses, qaOnly, signature, columnFilters],
  );

  const selectedLoadedRows = useCallback(
    () => (rows ?? []).filter((r) => isRowSelected(r.string_id)),
    [rows, isRowSelected],
  );

  const resolveSelectedIds = useCallback(async (): Promise<number[]> => {
    if (selectAllMatching) {
      const { ids: all } = await api.strings.matchingIds({ modId, ...buildFilter() });
      return selected.size ? all.filter((id) => !selected.has(id)) : all;
    }
    return [...selected];
  }, [selectAllMatching, selected, modId, buildFilter]);

  const toggleRow = useCallback((row: StringRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.string_id)) next.delete(row.string_id);
      else next.add(row.string_id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectAllMatching(true);
      setSelected(new Set());
    }
  }, [allSelected, clearSelection]);

  return {
    selectAllMatching,
    selected,
    setSelected,
    isRowSelected,
    selectedCount,
    hasSelection,
    allSelected,
    someSelected,
    clearSelection,
    buildFilter,
    selectedLoadedRows,
    resolveSelectedIds,
    toggleRow,
    toggleAll,
  };
}
