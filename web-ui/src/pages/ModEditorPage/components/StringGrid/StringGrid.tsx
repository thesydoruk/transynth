import { useState, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { rowBg, rowTextColor } from '../../utils';
import styles from './StringGrid.module.scss';

/** Keys identifying each resizable column in the string grid. */
type ColKey = 'grup' | 'formid' | 'edid' | 'field' | 'src' | 'transl' | 'act';

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
  selected: Set<number>;
  activeRow: StringRow | null;
  srcLang: string;
  targetLang: string;
  sortCol: SortCol | null;
  sortDir: SortDir;
  columnFilters: ColumnFilters;

  onRowClick: (row: StringRow) => void;
  onToggleRow: (row: StringRow, e: React.MouseEvent) => void;
  onToggleAll: () => void;
  onSort: (col: SortCol) => void;
  onColumnFilterChange: (col: keyof ColumnFilters, value: string) => void;
  onContextMenu: (e: React.MouseEvent, row: StringRow) => void;
  onApprove: (row: StringRow) => void;
  onReject: (row: StringRow) => void;
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
  isLoading,
  selected,
  activeRow,
  srcLang,
  targetLang,
  sortCol,
  sortDir,
  columnFilters,
  onRowClick,
  onToggleRow,
  onToggleAll,
  onSort,
  onColumnFilterChange,
  onContextMenu,
  onApprove,
  onReject,
  onClear,
  onCopySource,
}: StringGridProps) => {
  const { t } = useTranslation();

  /* ── Resizable column widths ── */
  const [colWidths, setColWidths] = useState<Record<ColKey, number | null>>({
    grup: 52, formid: 70, edid: 160, field: 50, src: null, transl: null, act: 170,
  });
  const resizeRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null);

  /**
   * Initiates a column resize drag.  Reads the rendered width of the header
   * cell from the DOM, then tracks mousemove until mouseup.
   */
  const startResize = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const thEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const startW = thEl.getBoundingClientRect().width;
    resizeRef.current = { col, startX: e.clientX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(30, resizeRef.current.startW + delta);
      setColWidths((prev) => ({ ...prev, [resizeRef.current!.col]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  /** Returns the inline CSS style for a resizable column cell. */
  const colStyle = useCallback((col: ColKey): React.CSSProperties => {
    const w = colWidths[col];
    return w !== null
      ? { flex: `0 0 ${w}px`, overflow: 'hidden' }
      : { flex: 1, minWidth: 180, overflow: 'hidden' };
  }, [colWidths]);

  /** Helper — renders a sortable column header with a resize handle. */
  const renderSortableHeader = (col: SortCol, label: string) => (
    <div className={`${styles.th} ${styles.sortable}`} style={colStyle(col)} onClick={() => onSort(col)}>
      {label}
      {sortCol === col && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
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

  return (
    <div className={styles.tableWrap} ref={scrollRef}>
      {isLoading ? (
        <div className={styles.center}>{t('common.loading')}</div>
      ) : (
        <>
          {/* Sticky header */}
          <div className={styles.gridHeader}>
            <div className={`${styles.th} ${styles.colCheck}`}>
              <input type="checkbox" checked={!!rows.length && selected.size === rows.length} onChange={onToggleAll} />
            </div>
            {renderSortableHeader('grup', t('modEditor.grup'))}
            {renderSortableHeader('formid', t('modEditor.formId'))}
            {renderSortableHeader('edid', t('modEditor.edid'))}
            {renderSortableHeader('field', t('modEditor.field'))}
            {renderSortableHeader('src', t('modEditor.sourceText', { lang: srcLang.toUpperCase() }))}
            {renderSortableHeader('transl', t('modEditor.translationText', { lang: targetLang.toUpperCase() }))}
            <div className={styles.th} style={colStyle('act')}>
              {t('modEditor.actions')}
              <span className={styles.resizeHandle} onMouseDown={(e) => startResize('act', e)} />
            </div>
          </div>

          {/* Per-column filter row */}
          <div className={styles.filterRow}>
            <div className={styles.colCheck} />
            <div style={colStyle('grup')}>
              <input className={styles.filterInput} placeholder={t('modEditor.grup')} value={columnFilters.grup} onChange={(e) => onColumnFilterChange('grup', e.target.value)} />
            </div>
            <div style={colStyle('formid')}>
              <input className={styles.filterInput} placeholder={t('modEditor.formId')} value={columnFilters.formid} onChange={(e) => onColumnFilterChange('formid', e.target.value)} />
            </div>
            <div style={colStyle('edid')}>
              <input className={styles.filterInput} placeholder={t('modEditor.edid')} value={columnFilters.edid} onChange={(e) => onColumnFilterChange('edid', e.target.value)} />
            </div>
            <div style={colStyle('field')}>
              <input className={styles.filterInput} placeholder={t('modEditor.field')} value={columnFilters.field} onChange={(e) => onColumnFilterChange('field', e.target.value)} />
            </div>
            <div style={colStyle('src')}>
              <input className={styles.filterInput} placeholder={t('modEditor.sourceText', { lang: srcLang.toUpperCase() })} value={columnFilters.src} onChange={(e) => onColumnFilterChange('src', e.target.value)} />
            </div>
            <div style={colStyle('transl')}>
              <input className={styles.filterInput} placeholder={t('modEditor.translationText', { lang: targetLang.toUpperCase() })} value={columnFilters.transl} onChange={(e) => onColumnFilterChange('transl', e.target.value)} />
            </div>
            <div style={colStyle('act')} />
          </div>

          {/* Virtualised rows */}
          <div className={styles.virtualScroll} style={{ height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const row = rows[vItem.index];
              const isActive = activeRow?.string_id === row.string_id;
              const displayStatus = isActive ? '__active' : row.status;

              return (
                <div
                  key={row.string_id}
                  data-index={vItem.index}
                  ref={rowVirtualizer.measureElement}
                  className={`${styles.gridRow} ${styles.virtualRow}`}
                  style={{
                    transform: `translateY(${vItem.start}px)`,
                    background: rowBg(displayStatus),
                    color: rowTextColor(displayStatus),
                    outline: isActive ? '1px solid #aaa' : 'none',
                  }}
                  onClick={() => onRowClick(row)}
                  onContextMenu={(e) => onContextMenu(e, row)}
                >
                  <div className={`${styles.td} ${styles.colCheck}`} onClick={(e) => onToggleRow(row, e)}>
                    <input type="checkbox" checked={selected.has(row.string_id)} onChange={() => {}} />
                  </div>
                  <div className={styles.tdSig} style={colStyle('grup')}>{row.signature}</div>
                  <div className={styles.tdFid} style={colStyle('formid')}>{row.formid_hex}</div>
                  <div className={styles.tdEdidCell} style={colStyle('edid')} title={row.edid ?? ''}>{row.edid ?? ''}</div>
                  <div className={styles.tdField} style={colStyle('field')}>{row.path?.split('\\').pop() ?? ''}</div>
                  <div className={styles.tdText} style={colStyle('src')} title={row.source}>{row.source}</div>
                  <div className={row.translation ? styles.tdTranslFilled : styles.tdTranslEmpty} style={colStyle('transl')} title={row.translation ?? ''}>
                    {row.translation ?? '—'}
                    {row.qa_issue_count > 0 && (
                      <span className={styles.qaHint}>{row.qa_issue_count} QA</span>
                    )}
                  </div>
                  <div className={`${styles.td} ${styles.colAct}`} style={colStyle('act')} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.actionBtnRow}>
                      {row.translation && row.status !== 'reviewed' && row.status !== 'human' && row.translation_id && (
                        <button className={styles.actionBtnBlue} title={t('modEditor.confirm')} onClick={() => onApprove(row)}>V</button>
                      )}
                      {row.translation && row.status !== 'rejected' && row.translation_id && (
                        <button className={styles.actionBtnRed} title={t('modEditor.reject')} onClick={() => onReject(row)}>R</button>
                      )}
                      <button className={styles.actionBtnRed} title={t('modEditor.clearTranslation')} onClick={() => onClear(row)}>X</button>
                      <button className={styles.actionBtnGreen} title={t('modEditor.copySourceToTranslation')} onClick={() => onCopySource(row)}>C</button>
                      <StatusBadge status={row.status} small />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
