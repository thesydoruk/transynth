import { useTranslation } from 'react-i18next';
import type { SpeakerGender } from '../../api';
import styles from './GenderBadge.module.scss';

const GENDER_SYMBOL: Record<SpeakerGender | 'neutral', string> = {
  male: '♂',
  female: '♀',
  any: '⚥',
  unknown: '?',
  neutral: '—',
};

export type LineGender = SpeakerGender | 'neutral';

export interface GenderBadgeProps {
  gender: LineGender | null | undefined;
  /** Compact mode for string grid cells. */
  compact?: boolean;
}

/** Read-only gender symbol for the string grid. */
export const GenderBadge = ({ gender, compact = false }: GenderBadgeProps) => {
  const { t } = useTranslation();
  const value = (gender ?? 'unknown') as LineGender;
  const symbol = GENDER_SYMBOL[value] ?? '?';
  const label = t(`dialogs.gender.${value === 'neutral' ? 'neutral' : value}`, {
    defaultValue: value,
  });

  return (
    <span
      className={`${styles.badge}${compact ? ` ${styles.compact}` : ''}`}
      data-gender={value}
      title={label}
      aria-label={label}
    >
      {symbol}
    </span>
  );
};
