import { useTranslation } from 'react-i18next';
import type { TranslationHistoryEntry } from '../../api';
import { StatusBadge } from '../../components/StatusBadge';
import styles from './ModEditorPage.module.scss';

interface HistoryPanelProps {
  items: TranslationHistoryEntry[];
}

/** Translation history panel for the active row. */
export const HistoryPanel = ({ items }: HistoryPanelProps) => {
  const { t } = useTranslation();

  if (items.length === 0) {
    return <div className={styles.panelEmpty}>{t('modEditor.emptyHistory')}</div>;
  }

  return (
    <div className={styles.panelListGap4}>
      {items.map((item) => (
        <div key={item.id} className={styles.historyRow}>
          <div className={styles.histHeader}>
            <StatusBadge status={item.status} small />
            <span className={styles.histDate}>{new Date(item.created_at).toLocaleString()}</span>
            {item.note && <span className={styles.histNote}>{item.note}</span>}
          </div>
          <div className={styles.histText}>{item.text ?? t('modEditor.cleared')}</div>
        </div>
      ))}
    </div>
  );
};