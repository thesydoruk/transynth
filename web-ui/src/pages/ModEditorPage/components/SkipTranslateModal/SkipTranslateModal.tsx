import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../components/Button';
import { ModalShell } from '../../../../components/ModalShell';
import type { LlmSkipDetectCandidate } from '../../../../api';
import type { SkipDetectState } from '../../hooks/useSkipDetect';
import s from './SkipTranslateModal.module.scss';

interface SkipTranslateModalProps {
  srcLang: string;
  state: SkipDetectState & {
    isRunning: boolean;
    start: (useLlm: boolean) => void;
    stop: () => void;
  };
  onClose: () => void;
  onRowClick?: (stringId: number) => void;
  onApply?: (candidate: LlmSkipDetectCandidate) => void | Promise<void>;
  onApplyAll?: (candidates: LlmSkipDetectCandidate[]) => void | Promise<void>;
}

const methodLabelKey = {
  heuristic: 'modEditor.skipDetectMethodHeuristic',
  llm: 'modEditor.skipDetectMethodLlm',
  both: 'modEditor.skipDetectMethodBoth',
} as const;

/** Modal for detecting strings that should not be translated. */
export const SkipTranslateModal = ({
  srcLang,
  state,
  onClose,
  onRowClick,
  onApply,
  onApplyAll,
}: SkipTranslateModalProps) => {
  const { t } = useTranslation();
  const { isRunning, done, total, candidates, error, status, start, stop } = state;
  const [useLlm, setUseLlm] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [appliedIds, setAppliedIds] = useState<Set<number>>(() => new Set());
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const visibleCandidates = useMemo(
    () => candidates.filter((c) => !appliedIds.has(c.stringId)),
    [candidates, appliedIds],
  );

  const handleApply = async (candidate: LlmSkipDetectCandidate) => {
    if (!onApply) return;
    setApplyingId(candidate.stringId);
    try {
      await onApply(candidate);
      setAppliedIds((prev) => new Set(prev).add(candidate.stringId));
    } finally {
      setApplyingId(null);
    }
  };

  const handleApplyAll = async () => {
    if (visibleCandidates.length === 0) return;
    setApplyingAll(true);
    try {
      if (onApplyAll) {
        await onApplyAll(visibleCandidates);
        setAppliedIds((prev) => {
          const next = new Set(prev);
          for (const c of visibleCandidates) next.add(c.stringId);
          return next;
        });
      } else if (onApply) {
        for (const candidate of visibleCandidates) {
          await onApply(candidate);
          setAppliedIds((prev) => new Set(prev).add(candidate.stringId));
        }
      }
    } finally {
      setApplyingAll(false);
    }
  };

  return (
    <ModalShell
      title={t('modEditor.skipDetectTitle')}
      onClose={onClose}
      closeAriaLabel={t('common.close')}
      size="xl"
      stretchContent
    >
      <p className={s.intro}>{t('modEditor.skipDetectIntro', { lang: srcLang.toUpperCase() })}</p>

      <div className={s.controls}>
        {isRunning ? (
          <Button variant="danger" size="sm" onClick={() => void stop()}>
            {t('modEditor.aiVerifyStop')}
          </Button>
        ) : (
          <>
            <label className={s.llmToggle}>
              <input
                type="checkbox"
                checked={useLlm}
                onChange={(e) => setUseLlm(e.target.checked)}
                disabled={status === 'running'}
              />
              {t('modEditor.skipDetectUseLlm')}
            </label>
            <Button variant="success" size="sm" onClick={() => void start(useLlm)}>
              {status === 'idle'
                ? t('modEditor.skipDetectStart')
                : t('modEditor.skipDetectRestart')}
            </Button>
          </>
        )}
        <div className={s.progressWrap}>
          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={s.progressLabel}>
            {isRunning
              ? t('modEditor.skipDetectProgress', { done, total })
              : status === 'completed'
                ? t('modEditor.skipDetectCompleted', { done, total, count: candidates.length })
                : status === 'cancelled'
                  ? t('modEditor.skipDetectCancelled', { done, total, count: candidates.length })
                  : status === 'failed'
                    ? t('modEditor.skipDetectFailed')
                    : t('modEditor.skipDetectIdle')}
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
              <th>{t('modEditor.skipDetectMethod')}</th>
              <th>{t('modEditor.aiVerifyReason')}</th>
              {onApply && <th>{t('modEditor.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {visibleCandidates.length === 0 ? (
              <tr>
                <td colSpan={onApply ? 6 : 5} className={s.empty}>
                  {isRunning
                    ? t('modEditor.skipDetectScanning')
                    : t('modEditor.skipDetectNoCandidates')}
                </td>
              </tr>
            ) : (
              visibleCandidates.map((candidate) => (
                <tr
                  key={candidate.stringId}
                  className={onRowClick ? s.clickable : undefined}
                  onClick={onRowClick ? () => onRowClick(candidate.stringId) : undefined}
                >
                  <td className={s.mono}>{candidate.edid ?? '—'}</td>
                  <td className={s.mono}>{candidate.path ?? candidate.signature ?? '—'}</td>
                  <td className={s.textCell}>{candidate.source}</td>
                  <td>{t(methodLabelKey[candidate.method])}</td>
                  <td className={s.reasonCell}>{candidate.reason}</td>
                  {onApply && (
                    <td className={s.actionCell}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={applyingId === candidate.stringId || applyingAll}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleApply(candidate);
                        }}
                      >
                        {applyingId === candidate.stringId
                          ? t('modEditor.skipDetectApplying')
                          : t('modEditor.skipDetectApply')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={s.footer}>
        {(onApply || onApplyAll) && visibleCandidates.length > 0 && (
          <Button
            variant="success"
            size="sm"
            disabled={applyingAll || isRunning || applyingId != null}
            onClick={() => void handleApplyAll()}
          >
            {applyingAll
              ? t('modEditor.skipDetectApplyingAll')
              : t('modEditor.skipDetectApplyAll', { count: visibleCandidates.length })}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </ModalShell>
  );
};
