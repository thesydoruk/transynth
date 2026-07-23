import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { LlmVerifyIssue } from '../../../../../api';
import { Button } from '../../../../../components/Button';
import s from '../AiVerifyModal.module.scss';

const verdictLabelKey = {
  suspicious: 'modEditor.aiVerifyVerdictSuspicious',
  incorrect: 'modEditor.aiVerifyVerdictIncorrect',
} as const;

type AiVerifyIssuesTableProps = {
  issues: LlmVerifyIssue[];
  isRunning: boolean;
  srcLang: string;
  targetLang: string;
  applyingId: number | null;
  applyingAll: boolean;
  onRowClick?: (stringId: number) => void;
  onApply?: (issue: LlmVerifyIssue) => void | Promise<void>;
};

export const AiVerifyIssuesTable = ({
  issues,
  isRunning,
  srcLang,
  targetLang,
  applyingId,
  applyingAll,
  onRowClick,
  onApply,
}: AiVerifyIssuesTableProps) => {
  const { t } = useTranslation();

  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>{t('modEditor.edid')}</th>
          <th>{t('modEditor.field')}</th>
          <th>{t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}</th>
          <th>{t('modEditor.translationText', { lang: targetLang.toUpperCase() })}</th>
          <th>{t('modEditor.aiVerifySuggestion')}</th>
          <th>{t('modEditor.aiVerifyVerdict')}</th>
          <th>{t('modEditor.aiVerifyReason')}</th>
          {onApply && <th>{t('modEditor.actions')}</th>}
        </tr>
      </thead>
      <tbody>
        {issues.length === 0 ? (
          <tr>
            <td colSpan={onApply ? 8 : 7} className={s.empty}>
              {isRunning ? t('modEditor.aiVerifyScanning') : t('modEditor.aiVerifyNoIssues')}
            </td>
          </tr>
        ) : (
          issues.map((issue: LlmVerifyIssue) => (
            <tr
              key={issue.stringId}
              className={onRowClick ? s.clickable : undefined}
              onClick={onRowClick ? () => onRowClick(issue.stringId) : undefined}
            >
              <td className={s.mono}>{issue.edid ?? '—'}</td>
              <td className={s.mono}>{issue.path ?? issue.signature ?? '—'}</td>
              <td className={s.textCell}>{issue.source}</td>
              <td className={s.textCell}>{issue.translation}</td>
              <td className={s.suggestionCell}>
                {issue.suggestion ?? <span className={s.noSuggestion}>—</span>}
              </td>
              <td>
                <span className={issue.verdict === 'incorrect' ? s.verdictBad : s.verdictWarn}>
                  {t(verdictLabelKey[issue.verdict as keyof typeof verdictLabelKey])}
                </span>
              </td>
              <td className={s.reasonCell}>{issue.reason}</td>
              {onApply && (
                <td className={s.actionCell}>
                  {issue.suggestion ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={applyingId === issue.stringId || applyingAll}
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        void onApply(issue);
                      }}
                    >
                      {applyingId === issue.stringId
                        ? t('modEditor.aiVerifyApplying')
                        : t('modEditor.aiVerifyApply')}
                    </Button>
                  ) : (
                    '—'
                  )}
                </td>
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
};
