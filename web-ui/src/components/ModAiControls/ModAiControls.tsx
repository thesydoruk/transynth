import { useTranslation } from 'react-i18next';
import type { ModAiJobEntry } from '../../modAiJobsStore';
import s from './ModAiControls.module.scss';

export interface ModAiControlsProps {
  translate: ModAiJobEntry;
  verify: ModAiJobEntry;
  skipDetect: ModAiJobEntry;
  onTranslate: () => void;
  onVerify: () => void;
  onSkipDetect: () => void;
  /** Compact layout for mod list rows. */
  compact?: boolean;
}

type SlotProps = {
  entry: ModAiJobEntry;
  label: string;
  runningLabel: string;
  icon: string;
  onClick: () => void;
  compact?: boolean;
};

const progressPct = (done: number, total: number): number | null => {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
};

const Slot = ({ entry, label, runningLabel, icon, onClick, compact }: SlotProps) => {
  const { t } = useTranslation();
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  const isFailed = entry.status === 'failed';
  const isDone =
    entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'failed';
  const pct = progressPct(entry.done, entry.total);

  let btnClass = s.btn;
  if (isRunning) btnClass += ` ${s.btnRunning}`;
  else if (isFailed) btnClass += ` ${s.btnFailed}`;
  else if (entry.status === 'completed') btnClass += ` ${s.btnCompleted}`;

  let statusText: string | null = null;
  if (entry.status === 'stopping') {
    statusText = t('modAi.statusStopping');
  } else if (isRunning) {
    statusText =
      entry.total > 0
        ? t('modAi.progressShort', { done: entry.done, total: entry.total })
        : runningLabel;
  } else if (entry.status === 'completed') {
    statusText = t('modAi.statusCompleted');
  } else if (entry.status === 'cancelled') {
    statusText = t('modAi.statusCancelled');
  } else if (entry.status === 'failed') {
    statusText = entry.error ?? t('modAi.statusFailed');
  }

  return (
    <div className={s.item}>
      <button
        type="button"
        className={btnClass}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={statusText ?? label}
        aria-label={label}
      >
        <span className={s.icon} aria-hidden>
          {icon}
        </span>
        <span className={s.label}>
          {entry.status === 'stopping'
            ? t('modAi.statusStopping')
            : isRunning
              ? runningLabel
              : label}
        </span>
      </button>
      {isRunning && pct != null && (
        <>
          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${pct}%` }} />
          </div>
          {!compact && statusText && <span className={s.statusChip}>{statusText}</span>}
        </>
      )}
      {!isRunning && isDone && statusText && !compact && (
        <span className={`${s.statusChip}${isFailed ? ` ${s.statusChipError}` : ''}`}>
          {statusText}
        </span>
      )}
      {compact && statusText && (
        <span className={`${s.progressLabel}${isFailed ? ` ${s.statusChipError}` : ''}`}>
          {statusText}
        </span>
      )}
    </div>
  );
};

/** Per-mod controls for skip-detect, auto-translate, and auto-verify with live status. */
export const ModAiControls = ({
  translate,
  verify,
  skipDetect,
  onTranslate,
  onVerify,
  onSkipDetect,
  compact = false,
}: ModAiControlsProps) => {
  const { t } = useTranslation();

  return (
    <div
      className={`${s.bar}${compact ? ` ${s.compact}` : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Slot
        entry={skipDetect}
        label={t('modEditor.skipDetect')}
        runningLabel={t('modEditor.skipDetectRunning')}
        icon="⊘"
        onClick={onSkipDetect}
        compact={compact}
      />
      <Slot
        entry={translate}
        label={t('modEditor.aiTranslate')}
        runningLabel={t('modEditor.aiTranslateRunning')}
        icon="⇄"
        onClick={onTranslate}
        compact={compact}
      />
      <Slot
        entry={verify}
        label={t('modEditor.aiVerify')}
        runningLabel={t('modEditor.aiVerifyRunning')}
        icon="✓"
        onClick={onVerify}
        compact={compact}
      />
    </div>
  );
};
