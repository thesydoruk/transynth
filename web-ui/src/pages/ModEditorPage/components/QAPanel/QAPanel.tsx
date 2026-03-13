import { useTranslation } from 'react-i18next';
import type { QAIssue } from '../../../../api';
import parentS from '../../ModEditorPage.module.scss';
import s from './QAPanel.module.scss';

interface QAPanelProps {
  issues: QAIssue[];
}

/** QA issues panel for the active translation row. */
export const QAPanel = ({ issues }: QAPanelProps) => {
  const { t } = useTranslation();

  if (issues.length === 0) {
    return <div className={parentS.panelEmpty}>{t('modEditor.noQaIssues')}</div>;
  }

  return (
    <div className={s.panelListGap2}>
      {issues.map((issue) => (
        <div key={issue.id} className={`${s.qaRow} ${issue.severity === 'error' ? s.qaRowError : s.qaRowWarning}`}>
          <span className={s.qaSeverity}>{issue.severity.toUpperCase()}</span>
          <span className={s.qaMsg}>{issue.message}</span>
        </div>
      ))}
    </div>
  );
};
