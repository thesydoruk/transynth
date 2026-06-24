import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import type { LlmVerifyIssue } from '../../../../api';
import type { AiVerifyState } from '../../hooks/useAiVerify';
import s from './AiVerifyModal.module.scss';

interface AiVerifyModalProps {
  srcLang: string;
  targetLang: string;
  state: AiVerifyState & {
    isRunning: boolean;
    isStopping?: boolean;
    start: (autoApproveVerified?: boolean) => void;
    stop: () => void;
  };
  onClose: () => void;
  onRowClick?: (stringId: number) => void;
  onApplySuggestion?: (issue: LlmVerifyIssue) => void | Promise<void>;
  onApplyAllSuggestions?: (issues: LlmVerifyIssue[]) => void | Promise<void>;
}

const verdictLabelKey = {
  suspicious: 'modEditor.aiVerifyVerdictSuspicious',
  incorrect: 'modEditor.aiVerifyVerdictIncorrect',
} as const;

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
  const { isRunning, isStopping, done, total, approved, issues, error, status, start, stop } =
    state;
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [appliedIds, setAppliedIds] = useState<Set<number>>(() => new Set());
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const visibleIssues = useMemo(
    () => issues.filter((issue) => !appliedIds.has(issue.stringId)),
    [issues, appliedIds],
  );

  const pendingIssues = useMemo(
    () => visibleIssues.filter((issue) => issue.suggestion),
    [visibleIssues],
  );

  const markApplied = (stringId: number) => {
    setAppliedIds((prev) => new Set(prev).add(stringId));
  };

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
      size="xl"
      stretchContent
    >
      <p className={s.intro}>
        {t('modEditor.aiVerifyIntro', {
          src: srcLang.toUpperCase(),
          target: targetLang.toUpperCase(),
        })}
      </p>

      <div className={s.controls}>
        {isRunning ? (
          <Button variant="danger" size="sm" disabled={isStopping} onClick={() => void stop()}>
            {isStopping ? t('modEditor.aiVerifyStopping') : t('modEditor.aiVerifyStop')}
          </Button>
        ) : (
          <>
            <label className={s.autoApproveToggle}>
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                disabled={status === 'running'}
              />
              {t('modEditor.aiVerifyAutoApprove')}
            </label>
            <Button
              variant="success"
              size="sm"
              onClick={() => void start(autoApprove)}
              disabled={status === 'running'}
            >
              {status === 'idle' ? t('modEditor.aiVerifyStart') : t('modEditor.aiVerifyRestart')}
            </Button>
          </>
        )}
        <div className={s.progressWrap}>
          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={s.progressLabel}>
            {isStopping
              ? t('modEditor.aiVerifyStopping')
              : isRunning
                ? t('modEditor.aiVerifyProgress', { done, total })
                : status === 'completed'
                  ? t('modEditor.aiVerifyCompleted', { done, total, count: issues.length }) +
                    (approved > 0 ? ` · ${t('modEditor.aiVerifyApproved', { approved })}` : '')
                  : status === 'cancelled'
                    ? t('modEditor.aiVerifyCancelled', { done, total, count: issues.length }) +
                      (approved > 0 ? ` · ${t('modEditor.aiVerifyApproved', { approved })}` : '')
                    : status === 'failed'
                      ? t('modEditor.aiVerifyFailed')
                      : t('modEditor.aiVerifyIdle')}
          </span>
        </div>
      </div>

      {error && <p className={s.error}>{error}</p>}

      <div className={s.tableWrap}>
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
              {onApplySuggestion && <th>{t('modEditor.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {visibleIssues.length === 0 ? (
              <tr>
                <td colSpan={onApplySuggestion ? 8 : 7} className={s.empty}>
                  {isRunning ? t('modEditor.aiVerifyScanning') : t('modEditor.aiVerifyNoIssues')}
                </td>
              </tr>
            ) : (
              visibleIssues.map((issue: LlmVerifyIssue) => (
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
                      {t(verdictLabelKey[issue.verdict])}
                    </span>
                  </td>
                  <td className={s.reasonCell}>{issue.reason}</td>
                  {onApplySuggestion && (
                    <td className={s.actionCell}>
                      {issue.suggestion ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={applyingId === issue.stringId || applyingAll}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleApply(issue);
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
      </div>

      <div className={s.footer}>
        {(onApplySuggestion || onApplyAllSuggestions) && pendingIssues.length > 0 && (
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
