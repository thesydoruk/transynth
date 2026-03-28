import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import s from './PaginationControls.module.scss';

export interface PaginationControlsProps {
  /** Label between navigation buttons, usually current page and total pages. */
  info: ReactNode;
  /** Navigate to the previous page. */
  onPrev: () => void;
  /** Navigate to the next page. */
  onNext: () => void;
  /** Disable previous navigation button. */
  prevDisabled?: boolean;
  /** Disable next navigation button. */
  nextDisabled?: boolean;
  /** Optional custom previous button label. */
  prevLabel?: ReactNode;
  /** Optional custom next button label. */
  nextLabel?: ReactNode;
}

/**
 * Reusable pager with Prev/Next buttons and a centered status label.
 */
export const PaginationControls = ({
  info,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  prevLabel,
  nextLabel,
}: PaginationControlsProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.pagination}>
      <Button variant="secondary" size="sm" onClick={onPrev} disabled={prevDisabled}>
        {prevLabel ?? t('common.prev')}
      </Button>
      <span className={s.info}>{info}</span>
      <Button variant="secondary" size="sm" onClick={onNext} disabled={nextDisabled}>
        {nextLabel ?? t('common.next')}
      </Button>
    </div>
  );
};