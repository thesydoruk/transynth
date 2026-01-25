import type { Stats } from '../api';
import s from './StatusBadge.module.scss';

/** Maps status keys to human-readable labels. */
const STATUS_LABELS: Record<string, string> = {
  reviewed: 'Reviewed',
  human: 'Approved',
  draft: 'Draft',
  rejected: 'Rejected',
  tm: 'TM match',
  fuzzy: 'Fuzzy',
  auto: 'Auto',
  untranslated: 'Untranslated',
};

const STATUS_COLORS: Record<string, string> = {
  reviewed: '#4caf50',
  human: '#4caf50',
  draft: '#8bc34a',
  rejected: '#b71c1c',
  tm: '#2196f3',
  fuzzy: '#00bcd4',
  auto: '#ff9800',
  untranslated: '#555',
};

type Props = {
  status: string | null;
  small?: boolean;
};

/**
 * Colored pill badge for a translation string status.
 * Background color is injected via the --badge-bg CSS custom property
 * so the dynamic value requires only a minimal inline style.
 */
export const StatusBadge = ({ status, small }: Props) => {
  const key = status ?? 'untranslated';
  const color = STATUS_COLORS[key] ?? '#888';
  const label = STATUS_LABELS[key] ?? key;
  return (
    <span
      className={`${s.badge}${small ? ` ${s.small}` : ''}`}
      style={{ '--badge-bg': color } as React.CSSProperties}
    >
      {label}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

/**
 * Segmented progress bar — each translation status gets a proportional colored slice.
 * Static layout (flex, height, border-radius) lives in SCSS; only width + background
 * are injected inline because they depend on runtime counts.
 */
export const ProgressBar = ({ stats }: { stats: Stats }) => {
  const { total, approved, draft, rejected, tm, fuzzy, auto_translated, untranslated } = stats;
  if (total === 0) return <span className={s.noStrings}>No strings</span>;

  /** Returns only the dynamic inline props for a segment (width + background). */
  const seg = (n: number, color: string) => ({
    width: `${(n / total) * 100}%`,
    background: color,
  });

  return (
    <div className={s.progressBar}>
      <div className={s.track}>
        <span className={s.segment} style={seg(approved, STATUS_COLORS.human)} title={`Approved: ${approved}`} />
        <span className={s.segment} style={seg(draft, STATUS_COLORS.draft)} title={`Draft: ${draft}`} />
        <span className={s.segment} style={seg(tm, STATUS_COLORS.tm)} title={`TM: ${tm}`} />
        <span className={s.segment} style={seg(fuzzy, STATUS_COLORS.fuzzy)} title={`Fuzzy: ${fuzzy}`} />
        <span className={s.segment} style={seg(auto_translated, STATUS_COLORS.auto)} title={`Auto: ${auto_translated}`} />
        <span className={s.segment} style={seg(rejected, STATUS_COLORS.rejected)} title={`Rejected: ${rejected}`} />
        <span className={s.segment} style={seg(untranslated, STATUS_COLORS.untranslated)} title={`Untranslated: ${untranslated}`} />
      </div>
      <span className={s.percentLabel}>{stats.percent}%</span>
    </div>
  );
}
