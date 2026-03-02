import s from './DashboardCard.module.scss';

interface DashboardCardProps {
  label: string;
  value: number;
  sub?: string;
  color?: string;
}

/** Summary stat card shown at the top of the dashboard. */
export const DashboardCard = ({ label, value, sub, color }: DashboardCardProps) => (
  <div className={s.card} style={{ '--card-color': color ?? '#fff' } as React.CSSProperties}>
    <div className={s.cardValue}>{value.toLocaleString()}</div>
    <div className={s.cardLabel}>
      {label}
      {sub && <span className={s.cardSub}>{sub}</span>}
    </div>
  </div>
);
