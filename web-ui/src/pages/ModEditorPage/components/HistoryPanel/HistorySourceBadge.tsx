import { useTranslation } from 'react-i18next';
import type { TranslationHistoryEntry } from '../../../../api';
import { historySourceAccentColor, resolveHistorySource } from './historySource';
import s from './HistorySourceBadge.module.scss';

interface HistorySourceBadgeProps {
  entry: TranslationHistoryEntry;
  small?: boolean;
}

/** Badge describing how a history revision was produced (LLM, TM, manual, …). */
export const HistorySourceBadge = ({ entry, small }: HistorySourceBadgeProps) => {
  const { t } = useTranslation();
  const source = resolveHistorySource(entry);
  const label = t(`history.source.${source}`, { defaultValue: source });
  const color = historySourceAccentColor(source);

  return (
    <span
      className={`${s.badge}${small ? ` ${s.small}` : ''}`}
      style={{ '--badge-bg': color } as React.CSSProperties}
    >
      {label}
    </span>
  );
};
