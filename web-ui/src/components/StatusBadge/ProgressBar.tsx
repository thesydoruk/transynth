import { useTranslation } from 'react-i18next';
import type { Stats } from '../../api';
import { STATUS_COLORS } from './statusColors';
import s from './StatusBadge.module.scss';

interface ProgressBarProps {
  /** Aggregate status counts used to render the proportional bar segments. */
  stats: Stats;
}

/**
 * Segmented progress bar — each translation status gets a proportional colored slice.
 * Static layout lives in SCSS; runtime width and background are injected inline.
 */
export const ProgressBar = ({ stats }: ProgressBarProps) => {
  const { t } = useTranslation();
  const { total, approved, draft, rejected, tm, fuzzy, auto_translated, untranslated } = stats;

  if (total === 0) return <span className={s.noStrings}>{t('status.noStrings')}</span>;

  const segmentStyle = (count: number, color: string): React.CSSProperties => ({
    width: `${(count / total) * 100}%`,
    background: color,
  });

  return (
    <div className={s.progressBar}>
      <div className={s.track}>
        <span
          className={s.segment}
          style={segmentStyle(approved, STATUS_COLORS.human)}
          title={t('progressBar.approved', { count: approved })}
        />
        <span
          className={s.segment}
          style={segmentStyle(draft, STATUS_COLORS.draft)}
          title={t('progressBar.draft', { count: draft })}
        />
        <span
          className={s.segment}
          style={segmentStyle(tm, STATUS_COLORS.tm)}
          title={t('progressBar.tm', { count: tm })}
        />
        <span
          className={s.segment}
          style={segmentStyle(fuzzy, STATUS_COLORS.fuzzy)}
          title={t('progressBar.fuzzy', { count: fuzzy })}
        />
        <span
          className={s.segment}
          style={segmentStyle(auto_translated, STATUS_COLORS.auto)}
          title={t('progressBar.auto', { count: auto_translated })}
        />
        <span
          className={s.segment}
          style={segmentStyle(rejected, STATUS_COLORS.rejected)}
          title={t('progressBar.rejected', { count: rejected })}
        />
        <span
          className={s.segment}
          style={segmentStyle(untranslated, STATUS_COLORS.untranslated)}
          title={t('progressBar.untranslated', { count: untranslated })}
        />
      </div>
      <span className={s.percentLabel}>{stats.percent}%</span>
    </div>
  );
};
