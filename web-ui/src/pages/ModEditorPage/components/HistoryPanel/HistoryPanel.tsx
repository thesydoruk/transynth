import { useTranslation } from 'react-i18next';
import type { TranslationHistoryEntry } from '../../../../api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { HistorySourceBadge } from './HistorySourceBadge';
import parentS from '../../ModEditorPage.module.scss';
import s from './HistoryPanel.module.scss';

interface HistoryPanelProps {
  items: TranslationHistoryEntry[];
}

/** Translation history panel for the active row. */
export const HistoryPanel = ({ items }: HistoryPanelProps) => {
  const { t } = useTranslation();

  if (items.length === 0) {
    return <div className={parentS.panelEmpty}>{t('modEditor.emptyHistory')}</div>;
  }

  return (
    <div className={parentS.panelListGap4}>
      {items.map((item) => (
        <div key={item.id} className={s.historyRow}>
          <div className={s.histHeader}>
            <HistorySourceBadge entry={item} small />
            <StatusBadge status={item.status} small />
            <span className={s.histDate}>{new Date(item.created_at).toLocaleString()}</span>
          </div>
          <div className={s.histText}>{item.text ?? t('modEditor.cleared')}</div>
        </div>
      ))}
    </div>
  );
};
