import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../components/Button';
import type { AiVerifyState } from '../../../hooks/useAiVerify';
import s from '../AiVerifyModal.module.scss';

type AiVerifyControlsProps = {
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
  autoApprove: boolean;
  onAutoApproveChange: (value: boolean) => void;
  fixSuspicious: boolean;
  onFixSuspiciousChange: (value: boolean) => void;
  includeConfirmed: boolean;
  onIncludeConfirmedChange: (value: boolean) => void;
};

export const AiVerifyControls = ({
  srcLang,
  targetLang,
  state,
  autoApprove,
  onAutoApproveChange,
  fixSuspicious,
  onFixSuspiciousChange,
  includeConfirmed,
  onIncludeConfirmedChange,
}: AiVerifyControlsProps) => {
  const { t } = useTranslation();
  const { isRunning, isStopping, done, total, approved, fixed, issues, status, start, stop } =
    state;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <p className={s.intro}>
        {t(
          includeConfirmed ? 'modEditor.aiVerifyIntroIncludeConfirmed' : 'modEditor.aiVerifyIntro',
          {
            src: srcLang.toUpperCase(),
            target: targetLang.toUpperCase(),
          },
        )}
      </p>

      <div className={s.controls}>
        {isRunning ? (
          <Button variant="danger" size="sm" disabled={isStopping} onClick={() => void stop()}>
            {isStopping ? t('modEditor.aiVerifyStopping') : t('modEditor.aiVerifyStop')}
          </Button>
        ) : (
          <div className={s.optionGroup}>
            <label className={s.optionToggle}>
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => onAutoApproveChange(e.target.checked)}
                disabled={status === 'running'}
              />
              {t('modEditor.aiVerifyAutoApprove')}
            </label>
            <label className={s.optionToggle}>
              <input
                type="checkbox"
                checked={includeConfirmed}
                onChange={(e) => onIncludeConfirmedChange(e.target.checked)}
                disabled={status === 'running'}
              />
              {t('modEditor.aiVerifyIncludeConfirmed')}
            </label>
            <label className={s.optionToggle}>
              <input
                type="checkbox"
                checked={fixSuspicious}
                onChange={(e) => onFixSuspiciousChange(e.target.checked)}
                disabled={status === 'running'}
              />
              {t('modEditor.aiVerifyFixSuspicious')}
            </label>
            <Button
              variant="success"
              size="sm"
              onClick={() => void start(autoApprove, fixSuspicious, includeConfirmed)}
              disabled={status === 'running'}
            >
              {status === 'idle' ? t('modEditor.aiVerifyStart') : t('modEditor.aiVerifyRestart')}
            </Button>
          </div>
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
                    (approved > 0 ? ` · ${t('modEditor.aiVerifyApproved', { approved })}` : '') +
                    (fixed > 0 ? ` · ${t('modEditor.aiVerifyFixed', { fixed })}` : '')
                  : status === 'cancelled'
                    ? t('modEditor.aiVerifyCancelled', { done, total, count: issues.length }) +
                      (approved > 0 ? ` · ${t('modEditor.aiVerifyApproved', { approved })}` : '') +
                      (fixed > 0 ? ` · ${t('modEditor.aiVerifyFixed', { fixed })}` : '')
                    : status === 'failed'
                      ? t('modEditor.aiVerifyFailed')
                      : t('modEditor.aiVerifyIdle')}
          </span>
        </div>
      </div>
    </>
  );
};
