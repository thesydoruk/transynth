import type { MouseEvent } from 'react';
import type { StringRow } from '../../../../api';
import type { EditorCapabilities } from '../../editorCapabilities';

/** Column keys that support server-side sorting. */
export type SortCol = 'grup' | 'formid' | 'edid' | 'field' | 'src' | 'transl';
export type SortDir = 'asc' | 'desc';

/** Per-column text filters. */
export interface ColumnFilters {
  grup: string;
  formid: string;
  edid: string;
  field: string;
  src: string;
  transl: string;
}

/** Props for the virtualised string grid. */
export interface StringGridProps {
  rows: StringRow[];
  total: number;
  isLoading: boolean;
  isRowSelected: (id: number) => boolean;
  allSelected: boolean;
  someSelected: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  activeRow: StringRow | null;
  srcLang: string;
  targetLang: string;
  sortCol: SortCol | null;
  sortDir: SortDir;
  columnFilters: ColumnFilters;
  onRowSelect: (row: StringRow) => void;
  onRowOpen: (row: StringRow) => void;
  focusedRow: StringRow | null;
  onToggleRow: (row: StringRow, e: MouseEvent) => void;
  onToggleAll: () => void;
  onSort: (col: SortCol) => void;
  onColumnFilterChange: (col: keyof ColumnFilters, value: string) => void;
  onContextMenu: (e: MouseEvent, row: StringRow) => void;
  onClear: (row: StringRow) => void;
  onCopySource: (row: StringRow) => void;
  capabilities?: EditorCapabilities;
}
