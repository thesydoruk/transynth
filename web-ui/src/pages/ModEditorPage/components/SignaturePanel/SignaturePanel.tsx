import { useTranslation } from 'react-i18next';
import styles from './SignaturePanel.module.scss';

/** A single row in the signature count list returned by the API. */
export interface SigCount {
  signature: string;
  count: number;
}

/** Props for the left-hand signature tree panel. */
export interface SignaturePanelProps {
  /** Signature count rows from the API. */
  sigCounts: SigCount[];
  /** Currently active signature filter (empty string = all). */
  activeSignature: string;
  /** Rows matching the current filter (numerator in the header). */
  totalFiltered: number | undefined;
  statusFilterActive?: boolean;
  /** Total strings in the mod (denominator when a status filter is active). */
  modTotal?: number;
  /** Called when the user clicks a signature row. */
  onSelect: (signature: string) => void;
}

/**
 * Left sidebar listing every record signature (WEAP, ARMO, BOOK …) with its
 * string count.  Clicking a row filters the grid to that signature.
 */
export const SignaturePanel = ({
  sigCounts,
  activeSignature,
  totalFiltered,
  statusFilterActive = false,
  modTotal,
  onSelect,
}: SignaturePanelProps) => {
  const { t } = useTranslation();
  const visibleSigs = statusFilterActive
    ? sigCounts.filter((row) => Number(row.count) > 0)
    : sigCounts;
  const filteredSum = visibleSigs.reduce((a, r) => a + Number(r.count), 0);
  const totalAll = statusFilterActive
    ? filteredSum
    : sigCounts.reduce((a, r) => a + Number(r.count), 0);
  const denominator = statusFilterActive ? (modTotal ?? totalAll) : totalAll;

  return (
    <div className={styles.leftPanel}>
      <div
        className={`${styles.sigRow} ${activeSignature === '' ? styles.sigRowActive : ''}`}
        onClick={() => onSelect('')}
      >
        <span className={styles.sigName}>{t('modEditor.allSigs')}</span>
        <span className={styles.sigCount}>
          {totalFiltered ?? '…'}
          {denominator > 0 ? ` / ${denominator}` : ''}
        </span>
      </div>
      {visibleSigs.map((sig) => (
        <div
          key={sig.signature}
          className={`${styles.sigRow} ${activeSignature === sig.signature ? styles.sigRowActive : ''}`}
          onClick={() => onSelect(sig.signature)}
        >
          <span className={styles.sigName}>{sig.signature}</span>
          <span className={styles.sigCount}>{sig.count}</span>
        </div>
      ))}
    </div>
  );
};
