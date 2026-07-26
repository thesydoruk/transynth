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
  /** Speaker or NPC name shown in the tooltip together with gender. */
  speakerName?: string | null;
  /** When set, overrides the default gender-only tooltip. */
  title?: string | null;
  /** Compact mode for string grid cells. */
  compact?: boolean;
}

/** Read-only gender symbol for the string grid. */
export const GenderBadge = ({
  gender,
  speakerName,
  title: titleOverride,
  compact = false,
}: GenderBadgeProps) => {
  const { t } = useTranslation();
  const value = (gender ?? 'unknown') as LineGender;
  const symbol = GENDER_SYMBOL[value] ?? '?';
  const genderLabel = t(`dialogs.gender.${value === 'neutral' ? 'neutral' : value}`, {
    defaultValue: value,
  });
  const title =
    titleOverride ??
    (speakerName?.trim()
      ? t('modEditor.genderLineTooltip', { name: speakerName.trim(), gender: genderLabel })
      : genderLabel);

  return (
    <span
      className={`${styles.badge}${compact ? ` ${styles.compact}` : ''}`}
      data-gender={value}
      title={title}
      aria-label={title}
    >
      {symbol}
    </span>
  );
};
