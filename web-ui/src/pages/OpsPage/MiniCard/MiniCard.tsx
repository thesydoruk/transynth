import s from './MiniCard.module.scss';

interface MiniCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

/** Small key-value card used in the operations summary rows. */
export const MiniCard = ({ label, value, sub, color }: MiniCardProps) => (
  <div className={s.card} style={color ? { '--card-color': color } as React.CSSProperties : undefined}>
    <div className={s.cardValue}>{value}</div>
    <div className={s.cardLabel}>
      {label}
      {sub && <span className={s.cardSub}>{sub}</span>}
    </div>
  </div>
);
