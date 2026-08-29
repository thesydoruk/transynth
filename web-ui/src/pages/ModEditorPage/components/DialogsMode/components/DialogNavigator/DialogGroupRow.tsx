import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogGroup } from '../../../../../../api';
import { ProgressPill } from '../ProgressPill';
import styles from './DialogNavigator.module.scss';

export interface DialogGroupRowProps {
  group: DialogGroup;
  active: boolean;
  onSelect: (key: string) => void;
}

/** One selectable group: name, size, translation progress, and QA warning. */
export const DialogGroupRow = memo(({ group, active, onSelect }: DialogGroupRowProps) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      onClick={() => onSelect(group.key)}
      title={group.sublabel ?? group.label}
    >
      <span className={styles.rowTop}>
        <span className={styles.rowLabel}>{group.label}</span>
        <span className={styles.rowNodes} title={t('dialogs.nodeCountTitle')}>
          {group.node_count}
        </span>
      </span>
      <span className={styles.rowBottom}>
        <ProgressPill
          done={group.translated_count}
          total={group.line_count}
          showCount
          title={t('dialogs.progressTitle', {
            done: group.translated_count,
            total: group.line_count,
          })}
        />
        {group.timing_sensitive && (
          <span className={styles.rowTiming} title={t('dialogs.timingSensitiveTitle')}>
            {t('dialogs.timingSensitive')}
          </span>
        )}
        {group.qa_count > 0 && (
          <span
            className={styles.rowQa}
            title={t('dialogs.qaIssueCount', { count: group.qa_count })}
          >
            QA {group.qa_count}
          </span>
        )}
      </span>
    </button>
  );
});

DialogGroupRow.displayName = 'DialogGroupRow';
