import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { GenderBadge } from '../../../../components/GenderBadge';
import { useStringGridColumnWidths } from '../../hooks/useStringGridColumnWidths';
import { rowBg, rowTextColor } from '../../utils';
import styles from './StringGrid.module.scss';

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
  /** Returns whether a given string ID is currently selected. */
  isRowSelected: (id: number) => boolean;
  /** Header checkbox fully-checked state (every matching row selected). */
  allSelected: boolean;
  /** Header checkbox indeterminate state (partial selection). */
  someSelected: boolean;
  /** Whether more pages remain to be fetched for infinite scroll. */
  hasMore: boolean;
  /** Whether the next page is currently being fetched. */
  isFetchingMore: boolean;
  /** Requests the next page (called as the user nears the end of the list). */
  onLoadMore: () => void;
  activeRow: StringRow | null;
  srcLang: string;
  targetLang: string;
  sortCol: SortCol | null;
  sortDir: SortDir;
  columnFilters: ColumnFilters;

  /** Single click — highlight row without opening the detail panel. */
  onRowSelect: (row: StringRow) => void;
  /** Double click — open the detail panel for editing. */
  onRowOpen: (row: StringRow) => void;
  /** Row highlighted in the grid (may differ from activeRow when the panel is closed). */
  focusedRow: StringRow | null;
  onToggleRow: (row: StringRow, e: React.MouseEvent) => void;
  onToggleAll: () => void;
  onSort: (col: SortCol) => void;
  onColumnFilterChange: (col: keyof ColumnFilters, value: string) => void;
  onContextMenu: (e: React.MouseEvent, row: StringRow) => void;
  onClear: (row: StringRow) => void;
  onCopySource: (row: StringRow) => void;
}

/**
 * Virtualised data grid for translation strings.
 *
 * Renders a sticky header row, a per-column filter row, and a
 * `@tanstack/react-virtual` scroll area.  All columns are resizable
 * via drag handles.
 */
export const StringGrid = ({
  rows,
  total,
  isLoading,
  isRowSelected,
  allSelected,
  someSelected,
  hasMore,
  isFetchingMore,
  onLoadMore,
  activeRow,
  srcLang,
  targetLang,
  sortCol,
  sortDir,
  columnFilters,
  onRowSelect,
  onRowOpen,
  focusedRow,
  onToggleRow,
  onToggleAll,
  onSort,
  onColumnFilterChange,
  onContextMenu,
  onClear,
  onCopySource,
}: StringGridProps) => {
  const { t } = useTranslation();
  const { colStyle, startResize } = useStringGridColumnWidths();

  /** Helper — renders a sortable column header with a resize handle. */
  const renderSortableHeader = (col: SortCol, label: string) => (
    <div
      className={`${styles.th} ${styles.sortable}`}
      style={colStyle(col)}
      onClick={() => onSort(col)}
    >
      {label}
      {sortCol === col && (
        <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
      )}
      <span className={styles.resizeHandle} onMouseDown={(e) => startResize(col, e)} />
    </div>
  );

  /* ── Virtualiser ── */
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  /* Infinite scroll: load the next page as the last rendered row approaches
   * the end of the currently-loaded set. */
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (hasMore && !isFetchingMore && last.index >= rows.length - 1 - 8) {
      onLoadMore();
    }
  }, [virtualItems, rows.length, hasMore, isFetchingMore, onLoadMore]);

  /* Scroll the active row into view whenever it changes (keyboard navigation). */
  const highlightedRow = activeRow ?? focusedRow;
  const activeIndex = highlightedRow
    ? rows.findIndex((r) => r.string_id === highlightedRow.string_id)
    : -1;
  useEffect(() => {
    if (activeIndex >= 0) {
      rowVirtualizer.scrollToIndex(activeIndex, { align: 'auto' });
    }
  }, [activeIndex]);

  /* Reflect the partial-selection state on the select-all checkbox. */
  const selectAllCheckRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllCheckRef.current) selectAllCheckRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className={styles.tableWrap} ref={scrollRef}>
      {isLoading ? (
        <div className={styles.center}>{t('common.loading')}</div>
      ) : (
        <>
          {/* Sticky header */}
          <div className={styles.gridHeader}>
            <div className={`${styles.th} ${styles.colCheck}`} />
            <div className={styles.th} style={colStyle('gender')} title={t('modEditor.genderCol')}>
              {t('modEditor.genderColShort')}
              <span className={styles.resizeHandle} onMouseDown={(e) => startResize('gender', e)} />
            </div>
            {renderSortableHeader('grup', t('modEditor.grup'))}
            {renderSortableHeader('formid', t('modEditor.formId'))}
            {renderSortableHeader('edid', t('modEditor.edid'))}
            {renderSortableHeader('field', t('modEditor.field'))}
            {renderSortableHeader(
              'src',
              t('modEditor.sourceText', { lang: srcLang.toUpperCase() }),
            )}
            {renderSortableHeader(
              'transl',
              t('modEditor.translationText', { lang: targetLang.toUpperCase() }),
            )}
            <div className={styles.th} style={colStyle('act')}>
              {t('modEditor.actions')}
              <span className={styles.resizeHandle} onMouseDown={(e) => startResize('act', e)} />
            </div>
          </div>

          {/* Per-column filter row */}
          <div className={styles.filterRow}>
            <div className={`${styles.colCheck} ${styles.filterCheck}`}>
              <input
                ref={selectAllCheckRef}
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                title={t('modEditor.selectAllMatching')}
              />
            </div>
            <div style={colStyle('gender')} />
            <div style={colStyle('grup')}>
              <input
                className={styles.filterInput}
                placeholder={t('modEditor.grup')}
                value={columnFilters.grup}
                onChange={(e) => onColumnFilterChange('grup', e.target.value)}
              />
            </div>
            <div style={colStyle('formid')}>
              <input
                className={styles.filterInput}
                placeholder={t('modEditor.formId')}
                value={columnFilters.formid}
                onChange={(e) => onColumnFilterChange('formid', e.target.value)}
              />
            </div>
            <div style={colStyle('edid')}>
              <input
                className={styles.filterInput}
                placeholder={t('modEditor.edid')}
                value={columnFilters.edid}
                onChange={(e) => onColumnFilterChange('edid', e.target.value)}
              />
            </div>
            <div style={colStyle('field')}>
              <input
                className={styles.filterInput}
                placeholder={t('modEditor.field')}
                value={columnFilters.field}
                onChange={(e) => onColumnFilterChange('field', e.target.value)}
              />
            </div>
            <div style={colStyle('src')}>
              <input
                className={styles.filterInput}
                placeholder={t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}
                value={columnFilters.src}
                onChange={(e) => onColumnFilterChange('src', e.target.value)}
              />
            </div>
            <div style={colStyle('transl')}>
              <input
                className={styles.filterInput}
                placeholder={t('modEditor.translationText', { lang: targetLang.toUpperCase() })}
                value={columnFilters.transl}
                onChange={(e) => onColumnFilterChange('transl', e.target.value)}
              />
            </div>
            <div style={colStyle('act')} />
          </div>

          {/* Virtualised rows */}
          <div className={styles.virtualScroll} style={{ height: rowVirtualizer.getTotalSize() }}>
            {virtualItems.map((vItem) => {
              const row = rows[vItem.index];
              const isActive = highlightedRow?.string_id === row.string_id;
              const displayStatus = isActive ? '__active' : row.status;

              return (
                <div
                  key={row.string_id}
                  data-index={vItem.index}
                  ref={rowVirtualizer.measureElement}
                  className={`${styles.gridRow} ${styles.virtualRow}${isActive ? ` ${styles.activeRow}` : ''}`}
                  style={{
                    transform: `translateY(${vItem.start}px)`,
                    background: rowBg(displayStatus),
                    color: rowTextColor(displayStatus),
                  }}
                  onClick={() => onRowSelect(row)}
                  onDoubleClick={() => onRowOpen(row)}
                  onContextMenu={(e) => onContextMenu(e, row)}
                >
                  <div
                    className={`${styles.td} ${styles.colCheck}`}
                    onClick={(e) => onToggleRow(row, e)}
                  >
                    <input
                      type="checkbox"
                      checked={isRowSelected(row.string_id)}
                      onChange={() => {}}
                    />
                  </div>
                  <div className={styles.tdGender} style={colStyle('gender')}>
                    <GenderBadge gender={row.line_gender} compact />
                  </div>
                  <div className={styles.tdSig} style={colStyle('grup')}>
                    {row.signature}
                  </div>
                  <div className={styles.tdFid} style={colStyle('formid')}>
                    {row.formid_hex}
                  </div>
                  <div
                    className={styles.tdEdidCell}
                    style={colStyle('edid')}
                    title={row.edid ?? ''}
                  >
                    {row.edid ?? ''}
                  </div>
                  <div className={styles.tdField} style={colStyle('field')}>
                    {row.path?.split('\\').pop() ?? ''}
                  </div>
                  <div className={styles.tdText} style={colStyle('src')} title={row.source}>
                    {row.source}
                  </div>
                  <div
                    className={row.translation ? styles.tdTranslFilled : styles.tdTranslEmpty}
                    style={colStyle('transl')}
                    title={row.translation ?? ''}
                  >
                    {row.translation ?? '—'}
                    {row.qa_issue_count > 0 && (
                      <span className={styles.qaHint}>{row.qa_issue_count} QA</span>
                    )}
                  </div>
                  <div
                    className={`${styles.td} ${styles.colAct}`}
                    style={colStyle('act')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={styles.actionBtnRow}>
                      <button
                        className={styles.actionBtnRed}
                        title={t('modEditor.clearTranslation')}
                        onClick={() => onClear(row)}
                      >
                        X
                      </button>
                      <button
                        className={styles.actionBtnGreen}
                        title={t('modEditor.copySourceToTranslation')}
                        onClick={() => onCopySource(row)}
                      >
                        C
                      </button>
                      <StatusBadge status={row.status} small />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Infinite-scroll footer: loaded count + loading indicator */}
          <div className={styles.loadMoreRow}>
            {isFetchingMore
              ? t('common.loading')
              : t('modEditor.loadedCount', { loaded: rows.length, total })}
          </div>
        </>
      )}
    </div>
  );
};
