import s from './DashboardPage.module.scss';

interface BarProps {
  value: number;
  max: number;
  color: string;
}

/** Mini horizontal bar chart for a single metric. */
export const Bar = ({ value, max, color }: BarProps) => {
  const width = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={s.barTrack}>
      <div className={s.barFill} style={{ background: color, width: `${width}%` }} />
    </div>
  );
};