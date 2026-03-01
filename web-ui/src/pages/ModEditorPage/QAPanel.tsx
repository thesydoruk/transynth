import { useTranslation } from 'react-i18next';
import type { QAIssue } from '../../api';
import styles from './ModEditorPage.module.scss';

interface QAPanelProps {
  issues: QAIssue[];
}

/** QA issues panel for the active translation row. */
export const QAPanel = ({ issues }: QAPanelProps) => {
  const { t } = useTranslation();

  if (issues.length === 0) {
    return <div className={styles.panelEmpty}>{t('modEditor.noQaIssues')}</div>;
  }

  return (
    <div className={styles.panelListGap2}>
      {issues.map((issue) => (
        <div key={issue.id} className={`${styles.qaRow} ${issue.severity === 'error' ? styles.qaRowError : styles.qaRowWarning}`}>
          <span className={styles.qaSeverity}>{issue.severity.toUpperCase()}</span>
          <span className={styles.qaMsg}>{issue.message}</span>
        </div>
      ))}
    </div>
  );
};