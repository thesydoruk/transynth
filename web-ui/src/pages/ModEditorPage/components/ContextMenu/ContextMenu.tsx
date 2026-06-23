import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import styles from './ContextMenu.module.scss';

/** Props for the right-click context menu shown over a grid row. */
export interface ContextMenuProps {
  /** Viewport position and the row the menu was invoked on. */
  anchor: { x: number; y: number; row: StringRow };
  /** Total number of selected rows (across the whole filtered set). */
  selectedCount: number;
  /**
   * When true the menu's actions target the whole selection (the clicked row
   * is part of an active selection); otherwise they target the clicked row.
   */
  actsOnSelection: boolean;
  /** Whether the bulk-review mutation is pending. */
  bulkReviewPending: boolean;

  onClose: () => void;
  onApprove: (row: StringRow) => void;
  onReject: (row: StringRow) => void;
  onClear: (row: StringRow) => void;
  onCopySource: (row: StringRow) => void;
  onTextTransform: (row: StringRow, transform: (text: string) => string) => void;
  onBulkCopySource: (row: StringRow) => void;
  onBatchTranslate: () => void;
}

/**
 * Fixed-position dropdown that appears on right-click over a grid row.
 *
 * When the clicked row is part of an active selection ({@link actsOnSelection}),
 * every action targets the whole selection and labels show the selected count.
 * Otherwise the actions operate on the single clicked row, with text transforms
 * (upper / lower / capitalise / trim) available for translated rows.
 */
export const ContextMenu = ({
  anchor,
  selectedCount,
  actsOnSelection,
  bulkReviewPending,
  onClose,
  onApprove,
  onReject,
  onClear,
  onCopySource,
  onTextTransform,
  onBulkCopySource,
  onBatchTranslate,
}: ContextMenuProps) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  const row = anchor.row;
  const hasTrans = !!row.translation;
  const hasTransId = !!row.translation_id;
  const bulkCount = selectedCount;

  /* Reposition the menu if it would overflow the viewport. */
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

  /* Close when clicking anywhere outside the menu. */
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
      {actsOnSelection ? (
        /* ── Selection actions (apply to every selected row) ── */
        <>
          <button
            className={styles.ctxItem}
            onClick={() => onApprove(row)}
            disabled={bulkReviewPending}
          >
            <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>✔</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkApprove', { count: bulkCount })}</span>
            <span className={styles.ctxKey}>F10</span>
          </button>
          <button
            className={styles.ctxItem}
            onClick={() => onReject(row)}
            disabled={bulkReviewPending}
          >
            <span className={`${styles.ctxIcon} ${styles.ctxIconRed}`}>✖</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkReject', { count: bulkCount })}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onClear(row)}>
            <span className={styles.ctxIcon}>⌫</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkClear', { count: bulkCount })}</span>
          </button>
          <div className={styles.ctxSep} />
          <button className={styles.ctxItem} onClick={onBatchTranslate}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⚡</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkTranslate', { count: bulkCount })}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onBulkCopySource(row)}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>⤵</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkCopySource', { count: bulkCount })}</span>
          </button>
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
            onClick={() => onTextTransform(row, (tx) => tx.trim())}
          >
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>✂</span>
            <span className={styles.ctxLabel}>{t('ctx.trim')}</span>
          </button>
        </>
      ) : (
        /* ── Single-row actions ── */
        <>
          {hasTrans && hasTransId && row.status !== 'reviewed' && row.status !== 'human' && (
            <button className={styles.ctxItem} onClick={() => onApprove(row)}>
              <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>✔</span>
              <span className={styles.ctxLabel}>{t('ctx.approve')}</span>
              <span className={styles.ctxKey}>Ctrl+Shift+A</span>
            </button>
          )}
          {hasTrans && hasTransId && row.status !== 'rejected' && (
            <button className={styles.ctxItem} onClick={() => onReject(row)}>
              <span className={`${styles.ctxIcon} ${styles.ctxIconRed}`}>✖</span>
              <span className={styles.ctxLabel}>{t('ctx.reject')}</span>
              <span className={styles.ctxKey}>Ctrl+Shift+R</span>
            </button>
          )}
          <button className={styles.ctxItem} onClick={() => onClear(row)}>
            <span className={styles.ctxIcon}>⌫</span>
            <span className={styles.ctxLabel}>{t('ctx.clear')}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onCopySource(row)}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>⤵</span>
            <span className={styles.ctxLabel}>{t('ctx.copySource')}</span>
          </button>

          {hasTrans && (
            <>
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
                onClick={() =>
                  onTextTransform(row, (tx) => tx.charAt(0).toUpperCase() + tx.slice(1))
                }
              >
                <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>Aa</span>
                <span className={styles.ctxLabel}>{t('ctx.capitalize')}</span>
              </button>
              <button
                className={styles.ctxItem}
                onClick={() => onTextTransform(row, (tx) => tx.trim())}
              >
                <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>✂</span>
                <span className={styles.ctxLabel}>{t('ctx.trim')}</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
};
