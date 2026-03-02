import s from './ConfidenceBar.module.scss';

interface ConfidenceBarProps {
  value: number | null;
}

/** Renders a mini confidence bar for machine-generated translation quality. */
export const ConfidenceBar = ({ value }: ConfidenceBarProps) => {
  if (value === null) return <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>;

  const percent = Math.round(value * 100);
  return (
    <span className={s.confCell}>
      <span className={s.confBar}>
        <span className={s.confFill} style={{ width: `${percent}%` }} />
      </span>
      <span className={s.confNum}>{percent}%</span>
    </span>
  );
};
