import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LlmVerifyIssue } from '../../../../api';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import type { AiVerifyState } from '../../hooks/useAiVerify';
import { AiVerifyActionLogTable } from './components/AiVerifyActionLogTable';
import { AiVerifyControls } from './components/AiVerifyControls';
import { AiVerifyIssuesTable } from './components/AiVerifyIssuesTable';
import { useAiVerifyApplyState } from './useAiVerifyApplyState';
import s from './AiVerifyModal.module.scss';

interface AiVerifyModalProps {
  srcLang: string;
  targetLang: string;
  state: AiVerifyState & {
    isRunning: boolean;
    isStopping?: boolean;
    start: (
      autoApproveVerified?: boolean,
      fixSuspicious?: boolean,
      includeConfirmed?: boolean,
    ) => void;
    stop: () => void;
  };
  onClose: () => void;
  onRowClick?: (stringId: number) => void;
  onApplySuggestion?: (issue: LlmVerifyIssue) => void | Promise<void>;
  onApplyAllSuggestions?: (issues: LlmVerifyIssue[]) => void | Promise<void>;
}

/** Modal for LLM translation quality verification with progress and flagged rows. */
export const AiVerifyModal = ({
  srcLang,
  targetLang,
  state,
  onClose,
  onRowClick,
  onApplySuggestion,
  onApplyAllSuggestions,
}: AiVerifyModalProps) => {
  const { t } = useTranslation();
  const { isRunning, issues, actionLog, error } = state;
  const [autoApprove, setAutoApprove] = useState(false);
  const [fixSuspicious, setFixSuspicious] = useState(false);
  const [includeConfirmed, setIncludeConfirmed] = useState(false);
  const showActionLog = autoApprove;

  const {
    applyingId,
    setApplyingId,
    applyingAll,
    setApplyingAll,
    visibleIssues,
    pendingIssues,
    markApplied,
    setAppliedIds,
  } = useAiVerifyApplyState(issues);

  const handleApply = async (issue: LlmVerifyIssue) => {
    if (!issue.suggestion || !onApplySuggestion) return;
    setApplyingId(issue.stringId);
    try {
      await onApplySuggestion(issue);
      markApplied(issue.stringId);
    } finally {
      setApplyingId(null);
    }
  };

  const handleApplyAll = async () => {
    if (pendingIssues.length === 0) return;
    setApplyingAll(true);
    try {
      if (onApplyAllSuggestions) {
        await onApplyAllSuggestions(pendingIssues);
        setAppliedIds((prev) => {
          const next = new Set(prev);
          for (const issue of pendingIssues) next.add(issue.stringId);
          return next;
        });
      } else if (onApplySuggestion) {
        for (const issue of pendingIssues) {
          await onApplySuggestion(issue);
          markApplied(issue.stringId);
        }
      }
    } finally {
      setApplyingAll(false);
    }
  };

  return (
    <ModalShell
      title={t('modEditor.aiVerifyTitle')}
      onClose={onClose}
      closeAriaLabel={t('common.close')}
      size="2xl"
      stretchContent
    >
      <AiVerifyControls
        srcLang={srcLang}
        targetLang={targetLang}
        state={state}
        autoApprove={autoApprove}
        onAutoApproveChange={setAutoApprove}
        fixSuspicious={fixSuspicious}
        onFixSuspiciousChange={setFixSuspicious}
        includeConfirmed={includeConfirmed}
        onIncludeConfirmedChange={setIncludeConfirmed}
      />

      {error && <p className={s.error}>{error}</p>}

      <div className={s.tableWrap}>
        {showActionLog ? (
          <AiVerifyActionLogTable
            actionLog={actionLog}
            isRunning={isRunning}
            srcLang={srcLang}
            onRowClick={onRowClick}
          />
        ) : (
          <AiVerifyIssuesTable
            issues={visibleIssues}
            isRunning={isRunning}
            srcLang={srcLang}
            targetLang={targetLang}
            applyingId={applyingId}
            applyingAll={applyingAll}
            onRowClick={onRowClick}
            onApply={onApplySuggestion ? handleApply : undefined}
          />
        )}
      </div>

      <div className={s.footer}>
        {!showActionLog &&
          (onApplySuggestion || onApplyAllSuggestions) &&
          pendingIssues.length > 0 && (
            <Button
              variant="success"
              size="sm"
              disabled={applyingAll || isRunning || applyingId != null}
              onClick={() => void handleApplyAll()}
            >
              {applyingAll
                ? t('modEditor.aiVerifyApplyingAll')
                : t('modEditor.aiVerifyApplyAll', { count: pendingIssues.length })}
            </Button>
          )}
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </ModalShell>
  );
};
