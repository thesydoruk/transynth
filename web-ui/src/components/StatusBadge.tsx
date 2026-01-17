import type { Stats } from '../api';

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

export const StatusBadge = ({ status, small }: Props) => {
  const key = status ?? 'untranslated';
  const color = STATUS_COLORS[key] ?? '#888';
  const label = STATUS_LABELS[key] ?? key;
  return (
    <span
      style={{
        background: color,
        color: '#fff',
        borderRadius: 4,
        padding: small ? '1px 6px' : '2px 8px',
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export const ProgressBar = ({ stats }: { stats: Stats }) => {
  const { total, approved, draft, rejected, tm, fuzzy, auto_translated, untranslated } = stats;
  if (total === 0) return <span style={{ color: '#888', fontSize: 12 }}>No strings</span>;

  const seg = (n: number, color: string) => ({
    width: `${(n / total) * 100}%`,
    background: color,
    height: 8,
    display: 'inline-block' as const,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          borderRadius: 4,
          overflow: 'hidden',
          height: 8,
          background: '#333',
        }}
      >
        <span style={seg(approved, STATUS_COLORS.human)} title={`Approved: ${approved}`} />
        <span style={seg(draft, STATUS_COLORS.draft)} title={`Draft: ${draft}`} />
        <span style={seg(tm, STATUS_COLORS.tm)} title={`TM: ${tm}`} />
        <span style={seg(fuzzy, STATUS_COLORS.fuzzy)} title={`Fuzzy: ${fuzzy}`} />
        <span style={seg(auto_translated, STATUS_COLORS.auto)} title={`Auto: ${auto_translated}`} />
        <span style={seg(rejected, STATUS_COLORS.rejected)} title={`Rejected: ${rejected}`} />
        <span style={seg(untranslated, STATUS_COLORS.untranslated)} title={`Untranslated: ${untranslated}`} />
      </div>
      <span style={{ fontSize: 12, color: '#bbb', minWidth: 36 }}>{stats.percent}%</span>
    </div>
  );
}
