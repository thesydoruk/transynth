import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import { statusAccentColor } from '../../../../components/StatusBadge/statusColors';
import { CONTEXT_MENU_STATUSES, type ContextMenuStatus } from '../../statusFilter';
import styles from './ContextMenu.module.scss';

/** Props for the right-click context menu shown over a grid row. */
export interface ContextMenuProps {
  /** Viewport position and the row the menu was invoked on. */
  anchor: { x: number; y: number; row: StringRow };
  /** Rows the menu actions target (selection size, or 1 for the clicked row). */
  targetCount: number;
  /** When true, checkbox selection exists and actions apply to it (not only the clicked row). */
  multiTarget: boolean;

  onClose: () => void;
  onClear: (row: StringRow) => void;
  onCopySource: (row: StringRow) => void;
  onTextTransform: (row: StringRow, transform: (text: string) => string) => void;
  onBatchTranslate: () => void;
  onBatchApplyTm: () => void;
  onRowTranslate: (row: StringRow, mode: 'llm' | 'tm') => void;
  onSetSkip: (row: StringRow, skip: boolean) => void;
  onSetStatus: (row: StringRow, status: ContextMenuStatus) => void;
}

/**
 * Fixed-position dropdown that appears on right-click over a grid row.
 * Item set is identical for every invocation; only labels reflect the target count.
 */
export const ContextMenu = ({
  anchor,
  targetCount,
  multiTarget,
  onClose,
  onClear,
  onCopySource,
  onTextTransform,
  onBatchTranslate,
  onBatchApplyTm,
  onRowTranslate,
  onSetSkip,
  onSetStatus,
}: ContextMenuProps) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  const row = anchor.row;
  const count = targetCount;

  const labelForCount = (singleKey: string, bulkKey: string) =>
    count === 1 ? t(singleKey) : t(bulkKey, { count });

  const renderStatusItems = () =>
    CONTEXT_MENU_STATUSES.map((status) => {
      const effectiveStatus = row.status === 'human' ? 'reviewed' : row.status;
      const isCurrent = count === 1 && effectiveStatus === status;
      const color = statusAccentColor(status);
      const label =
        count === 1
          ? t(`status.${status}`, { defaultValue: status })
          : t('ctx.bulkSetStatus', {
              status: t(`status.${status}`, { defaultValue: status }),
              count,
            });
      return (
        <button key={status} className={styles.ctxItem} onClick={() => onSetStatus(row, status)}>
          <span className={styles.ctxCheck} aria-hidden>
            {isCurrent ? '✓' : ''}
          </span>
          <span
            className={styles.ctxStatusDot}
            style={{ '--status-color': color } as React.CSSProperties}
            aria-hidden
          />
          <span className={styles.ctxLabel}>{label}</span>
        </button>
      );
    });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = anchor.x;
    let y = anchor.y;
    if (x + rect.width > window.innerWidth) x = Math.max(0, x - rect.width);
    if (y + rect.height > window.innerHeight) y = Math.max(0, y - rect.height);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = '1';
  }, [anchor]);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={styles.ctxMenu}
      style={{ top: anchor.y, left: anchor.x, opacity: 0 }}
      onClick={onClose}
    >
      <button className={styles.ctxItem} onClick={() => onClear(row)}>
        <span className={styles.ctxIcon}>⌫</span>
        <span className={styles.ctxLabel}>{labelForCount('ctx.clear', 'ctx.bulkClear')}</span>
      </button>
      <button className={styles.ctxItem} onClick={() => onCopySource(row)}>
        <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>⤵</span>
        <span className={styles.ctxLabel}>
          {labelForCount('ctx.copySource', 'ctx.bulkCopySource')}
        </span>
      </button>
      <div className={styles.ctxSep} />
      <button
        className={styles.ctxItem}
        onClick={() => (multiTarget ? onBatchApplyTm() : onRowTranslate(row, 'tm'))}
      >
        <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>◎</span>
        <span className={styles.ctxLabel}>{labelForCount('ctx.applyTm', 'ctx.bulkApplyTm')}</span>
      </button>
      <button
        className={styles.ctxItem}
        onClick={() => (multiTarget ? onBatchTranslate() : onRowTranslate(row, 'llm'))}
      >
        <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⚡</span>
        <span className={styles.ctxLabel}>{labelForCount('ctx.applyLlm', 'ctx.bulkApplyLlm')}</span>
      </button>
      <div className={styles.ctxSep} />
      <div className={styles.ctxGroupLabel}>{t('ctx.statusSection')}</div>
      {renderStatusItems()}
      <div className={styles.ctxSep} />
      <button className={styles.ctxItem} onClick={() => onSetSkip(row, true)}>
        <span className={styles.ctxIcon}>⊘</span>
        <span className={styles.ctxLabel}>{labelForCount('ctx.markSkip', 'ctx.bulkMarkSkip')}</span>
      </button>
      <button className={styles.ctxItem} onClick={() => onSetSkip(row, false)}>
        <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>↩</span>
        <span className={styles.ctxLabel}>
          {labelForCount('ctx.unmarkSkip', 'ctx.bulkUnmarkSkip')}
        </span>
      </button>
      <div className={styles.ctxSep} />
      <button
        className={styles.ctxItem}
        onClick={() => onTextTransform(row, (tx) => tx.toUpperCase())}
      >
        <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⇧</span>
        <span className={styles.ctxLabel}>{t('ctx.uppercase')}</span>
      </button>
      <button
        className={styles.ctxItem}
        onClick={() => onTextTransform(row, (tx) => tx.toLowerCase())}
      >
        <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⇩</span>
        <span className={styles.ctxLabel}>{t('ctx.lowercase')}</span>
      </button>
      <button
        className={styles.ctxItem}
        onClick={() => onTextTransform(row, (tx) => tx.charAt(0).toUpperCase() + tx.slice(1))}
      >
        <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>Aa</span>
        <span className={styles.ctxLabel}>{t('ctx.capitalize')}</span>
      </button>
      <button className={styles.ctxItem} onClick={() => onTextTransform(row, (tx) => tx.trim())}>
        <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>✂</span>
        <span className={styles.ctxLabel}>{t('ctx.trim')}</span>
      </button>
    </div>
  );
};
