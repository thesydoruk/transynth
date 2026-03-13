import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import styles from './ContextMenu.module.scss';

/** Props for the right-click context menu shown over a grid row. */
export interface ContextMenuProps {
  /** Viewport position and the row the menu was invoked on. */
  anchor: { x: number; y: number; row: StringRow };
  /** Currently selected string IDs (for bulk operations). */
  selected: Set<number>;
  /** All rows on the current page (for bulk transforms). */
  rows: StringRow[];
  /** Target language for save operations. */
  targetLang: string;
  /** Whether the bulk-review mutation is pending. */
  bulkReviewPending: boolean;

  onClose: () => void;
  onApprove: (row: StringRow) => void;
  onReject: (row: StringRow) => void;
  onClear: (row: StringRow) => void;
  onCopySource: (row: StringRow) => void;
  onTextTransform: (row: StringRow, transform: (text: string) => string) => void;
  onBulkCopySource: (row: StringRow) => void;
  onBulkReview: (status: 'reviewed' | 'rejected') => void;
  onBatchTranslate: () => void;
}

/**
 * Fixed-position dropdown that appears on right-click over a grid row.
 * Supports single-row actions (approve / reject / clear / copy-source),
 * text transforms (upper / lower / capitalise / trim), and bulk operations
 * when multiple rows are selected.
 */
export const ContextMenu = ({
  anchor,
  selected,
  bulkReviewPending,
  onClose,
  onApprove,
  onReject,
  onClear,
  onCopySource,
  onTextTransform,
  onBulkCopySource,
  onBulkReview,
  onBatchTranslate,
}: ContextMenuProps) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  const row = anchor.row;
  const hasTrans = !!row.translation;
  const hasTransId = !!row.translation_id;
  const isBulk = selected.size > 1 && selected.has(row.string_id);
  const bulkCount = selected.size;

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
      {/* ── Status group ── */}
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

      {/* ── Text utilities group ── */}
      {hasTrans && (
        <>
          <div className={styles.ctxSep} />
          <button className={styles.ctxItem} onClick={() => onTextTransform(row, (tx) => tx.toUpperCase())}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⇧</span>
            <span className={styles.ctxLabel}>{t('ctx.uppercase')}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onTextTransform(row, (tx) => tx.toLowerCase())}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⇩</span>
            <span className={styles.ctxLabel}>{t('ctx.lowercase')}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onTextTransform(row, (tx) => tx.charAt(0).toUpperCase() + tx.slice(1))}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>Aa</span>
            <span className={styles.ctxLabel}>{t('ctx.capitalize')}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onTextTransform(row, (tx) => tx.trim())}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>✂</span>
            <span className={styles.ctxLabel}>{t('ctx.trim')}</span>
          </button>
        </>
      )}

      {/* ── Bulk group ── */}
      {isBulk && (
        <>
          <div className={styles.ctxSep} />
          <button className={styles.ctxItem} onClick={() => onBulkReview('reviewed')} disabled={bulkReviewPending}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>✔</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkApprove', { count: bulkCount })}</span>
            <span className={styles.ctxKey}>F10</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onBulkReview('rejected')} disabled={bulkReviewPending}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconRed}`}>✖</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkReject', { count: bulkCount })}</span>
          </button>
          <button className={styles.ctxItem} onClick={onBatchTranslate}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⚡</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkTranslate', { count: bulkCount })}</span>
          </button>
          <button className={styles.ctxItem} onClick={() => onBulkCopySource(row)}>
            <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>⤵</span>
            <span className={styles.ctxLabel}>{t('ctx.bulkCopySource', { count: bulkCount })}</span>
          </button>
        </>
      )}
    </div>
  );
};
