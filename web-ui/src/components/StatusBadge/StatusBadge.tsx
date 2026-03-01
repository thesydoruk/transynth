import { useTranslation } from 'react-i18next';
import { STATUS_COLORS } from './statusColors';
import s from './StatusBadge.module.scss';

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
  const { t } = useTranslation();
  const key = status ?? 'untranslated';
  const color = STATUS_COLORS[key] ?? '#888';
  const label = t(`status.${key}`, { defaultValue: key });
  return (
    <span
      className={`${s.badge}${small ? ` ${s.small}` : ''}`}
      style={{ '--badge-bg': color } as React.CSSProperties}
    >
      {label}
    </span>
  );
};
