import type { CSSProperties, MouseEvent } from 'react';
import type { TFunction } from 'i18next';
import type { StringRow } from '../../../../api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { GenderBadge } from '../../../../components/GenderBadge';
import { formatDiscoPoKey, type EditorCapabilities } from '../../editorCapabilities';
import type { StringGridColKey } from '../../hooks/useStringGridColumnWidths';
import { rowBg, rowTextColor } from '../../utils';
import { genderBadgeTitle } from './stringGridHelpers';
import styles from './StringGrid.module.scss';

type ColStyle = (col: StringGridColKey) => CSSProperties;

type StringGridRowProps = {
  row: StringRow;
  index: number;
  start: number;
  isActive: boolean;
  isSelected: boolean;
  showGender: boolean;
  showFormId: boolean;
  capabilities: EditorCapabilities;
  t: TFunction;
  colStyle: ColStyle;
  measureElement: (node: Element | null) => void;
  onRowSelect: (row: StringRow) => void;
  onRowOpen: (row: StringRow) => void;
  onToggleRow: (row: StringRow, event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent, row: StringRow) => void;
  onClear: (row: StringRow) => void;
  onCopySource: (row: StringRow) => void;
};

export const StringGridRow = ({
  row,
  index,
  start,
  isActive,
  isSelected,
  showGender,
  showFormId,
  capabilities,
  t,
  colStyle,
  measureElement,
  onRowSelect,
  onRowOpen,
  onToggleRow,
  onContextMenu,
  onClear,
  onCopySource,
}: StringGridRowProps) => {
  const displayStatus = isActive ? '__active' : row.status;
  const fieldTitle = capabilities.isDisco ? (row.path ?? '') : (row.path?.split('\\').pop() ?? '');
  const fieldLabel = capabilities.isDisco
    ? formatDiscoPoKey(row.path)
    : (row.path?.split('\\').pop() ?? '');

  return (
    <div
      data-index={index}
      ref={measureElement}
      className={`${styles.gridRow} ${styles.virtualRow}${isActive ? ` ${styles.activeRow}` : ''}`}
      style={{
        transform: `translateY(${start}px)`,
        background: rowBg(displayStatus),
        color: rowTextColor(displayStatus),
      }}
      onClick={() => onRowSelect(row)}
      onDoubleClick={() => onRowOpen(row)}
      onContextMenu={(event) => onContextMenu(event, row)}
    >
      <div
        className={`${styles.td} ${styles.colCheck}`}
        onClick={(event) => onToggleRow(row, event)}
      >
        <input type="checkbox" checked={isSelected} onChange={() => undefined} />
      </div>
      {showGender && (
        <div className={styles.tdGender} style={colStyle('gender')}>
          <GenderBadge gender={row.line_gender} title={genderBadgeTitle(row, t)} compact />
        </div>
      )}
      <div className={styles.tdSig} style={colStyle('grup')}>
        {row.signature}
      </div>
      {showFormId && (
        <div className={styles.tdFid} style={colStyle('formid')}>
          {row.formid_hex}
        </div>
      )}
      <div className={styles.tdEdidCell} style={colStyle('edid')} title={row.edid ?? ''}>
        {row.edid ?? ''}
      </div>
      <div className={styles.tdField} style={colStyle('field')} title={fieldTitle}>
        {fieldLabel}
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
        {row.qa_issue_count > 0 && <span className={styles.qaHint}>{row.qa_issue_count} QA</span>}
      </div>
      <div
        className={`${styles.td} ${styles.colAct}`}
        style={colStyle('act')}
        onClick={(event) => event.stopPropagation()}
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
};
