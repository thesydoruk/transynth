import type { CSSProperties, MouseEvent, RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { StringGridColKey } from '../../hooks/useStringGridColumnWidths';
import type { ColumnFilters, SortCol, SortDir } from './StringGrid.types';
import styles from './StringGrid.module.scss';

type ColStyle = (col: StringGridColKey) => CSSProperties;
type StartResize = (col: StringGridColKey, event: MouseEvent) => void;

type StringGridHeaderProps = {
  t: TFunction;
  showGender: boolean;
  showFormId: boolean;
  sigLabel: string;
  edidLabel: string;
  fieldLabel: string;
  srcLang: string;
  targetLang: string;
  sortCol: SortCol | null;
  sortDir: SortDir;
  columnFilters: ColumnFilters;
  allSelected: boolean;
  selectAllCheckRef: RefObject<HTMLInputElement | null>;
  colStyle: ColStyle;
  startResize: StartResize;
  onSort: (col: SortCol) => void;
  onToggleAll: () => void;
  onColumnFilterChange: (col: keyof ColumnFilters, value: string) => void;
};

export const StringGridHeader = ({
  t,
  showGender,
  showFormId,
  sigLabel,
  edidLabel,
  fieldLabel,
  srcLang,
  targetLang,
  sortCol,
  sortDir,
  columnFilters,
  allSelected,
  selectAllCheckRef,
  colStyle,
  startResize,
  onSort,
  onToggleAll,
  onColumnFilterChange,
}: StringGridHeaderProps) => {
  const sortableHeader = (col: SortCol, label: string) => (
    <div
      className={`${styles.th} ${styles.sortable}`}
      style={colStyle(col)}
      onClick={() => onSort(col)}
    >
      {label}
      {sortCol === col && (
        <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
      )}
      <span className={styles.resizeHandle} onMouseDown={(event) => startResize(col, event)} />
    </div>
  );

  return (
    <>
      <div className={styles.gridHeader}>
        <div className={`${styles.th} ${styles.colCheck}`} />
        {showGender && (
          <div className={styles.th} style={colStyle('gender')} title={t('modEditor.genderCol')}>
            {t('modEditor.genderColShort')}
            <span
              className={styles.resizeHandle}
              onMouseDown={(event) => startResize('gender', event)}
            />
          </div>
        )}
        {sortableHeader('grup', sigLabel)}
        {showFormId && sortableHeader('formid', t('modEditor.formId'))}
        {sortableHeader('edid', edidLabel)}
        {sortableHeader('field', fieldLabel)}
        {sortableHeader('src', t('modEditor.sourceText', { lang: srcLang.toUpperCase() }))}
        {sortableHeader(
          'transl',
          t('modEditor.translationText', { lang: targetLang.toUpperCase() }),
        )}
        <div className={styles.th} style={colStyle('act')}>
          {t('modEditor.actions')}
          <span
            className={styles.resizeHandle}
            onMouseDown={(event) => startResize('act', event)}
          />
        </div>
      </div>

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
        {showGender && <div style={colStyle('gender')} />}
        <div style={colStyle('grup')}>
          <input
            className={styles.filterInput}
            placeholder={sigLabel}
            value={columnFilters.grup}
            onChange={(event) => onColumnFilterChange('grup', event.target.value)}
          />
        </div>
        {showFormId && (
          <div style={colStyle('formid')}>
            <input
              className={styles.filterInput}
              placeholder={t('modEditor.formId')}
              value={columnFilters.formid}
              onChange={(event) => onColumnFilterChange('formid', event.target.value)}
            />
          </div>
        )}
        <div style={colStyle('edid')}>
          <input
            className={styles.filterInput}
            placeholder={edidLabel}
            value={columnFilters.edid}
            onChange={(event) => onColumnFilterChange('edid', event.target.value)}
          />
        </div>
        <div style={colStyle('field')}>
          <input
            className={styles.filterInput}
            placeholder={fieldLabel}
            value={columnFilters.field}
            onChange={(event) => onColumnFilterChange('field', event.target.value)}
          />
        </div>
        <div style={colStyle('src')}>
          <input
            className={styles.filterInput}
            placeholder={t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}
            value={columnFilters.src}
            onChange={(event) => onColumnFilterChange('src', event.target.value)}
          />
        </div>
        <div style={colStyle('transl')}>
          <input
            className={styles.filterInput}
            placeholder={t('modEditor.translationText', { lang: targetLang.toUpperCase() })}
            value={columnFilters.transl}
            onChange={(event) => onColumnFilterChange('transl', event.target.value)}
          />
        </div>
        <div style={colStyle('act')} />
      </div>
    </>
  );
};
