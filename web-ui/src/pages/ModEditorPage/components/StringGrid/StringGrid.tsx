/**
 * Virtualised data grid for translation strings.
 */

import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { editorCapabilities } from '../../editorCapabilities';
import { useStringGridColumnWidths } from '../../hooks/useStringGridColumnWidths';
import { StringGridHeader } from './StringGridHeader';
import { StringGridRow } from './StringGridRow';
import type { StringGridProps } from './StringGrid.types';
import styles from './StringGrid.module.scss';

export type { SortCol, SortDir, ColumnFilters, StringGridProps } from './StringGrid.types';

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
  capabilities: capabilitiesProp,
}: StringGridProps) => {
  const { t } = useTranslation();
  const { colStyle, startResize } = useStringGridColumnWidths();
  const capabilities = capabilitiesProp ?? editorCapabilities('fo4');
  const showGender = capabilities.showGenderColumn;
  const showFormId = capabilities.showFormIdColumn;
  const sigLabel = t(`modEditor.${capabilities.labels.signature}`);
  const edidLabel = t(`modEditor.${capabilities.labels.edid}`);
  const fieldLabel = t(`modEditor.${capabilities.labels.field}`);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (hasMore && !isFetchingMore && last.index >= rows.length - 1 - 8) {
      onLoadMore();
    }
  }, [virtualItems, rows.length, hasMore, isFetchingMore, onLoadMore]);

  const highlightedRow = activeRow ?? focusedRow;
  const activeIndex = highlightedRow
    ? rows.findIndex((row) => row.string_id === highlightedRow.string_id)
    : -1;
  useEffect(() => {
    if (activeIndex >= 0) {
      rowVirtualizer.scrollToIndex(activeIndex, { align: 'auto' });
    }
  }, [activeIndex]);

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
          <StringGridHeader
            t={t}
            showGender={showGender}
            showFormId={showFormId}
            sigLabel={sigLabel}
            edidLabel={edidLabel}
            fieldLabel={fieldLabel}
            srcLang={srcLang}
            targetLang={targetLang}
            sortCol={sortCol}
            sortDir={sortDir}
            columnFilters={columnFilters}
            allSelected={allSelected}
            selectAllCheckRef={selectAllCheckRef}
            colStyle={colStyle}
            startResize={startResize}
            onSort={onSort}
            onToggleAll={onToggleAll}
            onColumnFilterChange={onColumnFilterChange}
          />

          <div className={styles.virtualScroll} style={{ height: rowVirtualizer.getTotalSize() }}>
            {virtualItems.map((item) => {
              const row = rows[item.index];
              return (
                <StringGridRow
                  key={row.string_id}
                  row={row}
                  index={item.index}
                  start={item.start}
                  isActive={highlightedRow?.string_id === row.string_id}
                  isSelected={isRowSelected(row.string_id)}
                  showGender={showGender}
                  showFormId={showFormId}
                  capabilities={capabilities}
                  t={t}
                  colStyle={colStyle}
                  measureElement={rowVirtualizer.measureElement}
                  onRowSelect={onRowSelect}
                  onRowOpen={onRowOpen}
                  onToggleRow={onToggleRow}
                  onContextMenu={onContextMenu}
                  onClear={onClear}
                  onCopySource={onCopySource}
                />
              );
            })}
          </div>

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
