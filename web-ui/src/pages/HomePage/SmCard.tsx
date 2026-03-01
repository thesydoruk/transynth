import s from './HomePage.module.scss';

interface SmCardProps {
  label: string;
  value: string;
  color?: string;
}

/** Compact system-status card used in Ops-derived strips. */
export const SmCard = ({ label, value, color }: SmCardProps) => (
  <div className={s.smCard} style={color ? { '--card-color': color } as React.CSSProperties : undefined}>
    <span className={s.smCardValue}>{value}</span>
    <span className={s.smCardLabel}>{label}</span>
  </div>
);