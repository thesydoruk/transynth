import s from './BigCard.module.scss';

interface BigCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

/** Large summary card used in the project stats strip. */
export const BigCard = ({ label, value, sub, color }: BigCardProps) => (
  <div className={s.bigCard} style={color ? { '--card-color': color } as React.CSSProperties : undefined}>
    <div className={s.bigCardValue}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    <div className={s.bigCardLabel}>
      {label}
      {sub && <span className={s.bigCardSub}> {sub}</span>}
    </div>
  </div>
);
