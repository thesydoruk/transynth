import s from './Bar.module.scss';

interface BarProps {
  value: number;
  max: number;
  color: string;
}

/** Horizontal progress bar used in mod and GRUP breakdown tables. */
export const Bar = ({ value, max, color }: BarProps) => {
  const width = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={s.barTrack}>
      <div className={s.barFill} style={{ background: color, width: `${width}%` }} />
    </div>
  );
};
