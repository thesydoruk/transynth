import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  CircularProgressButton,
  type CircularProgressButtonMenuItem,
  type CircularProgressButtonState,
  type CircularProgressButtonTone,
} from '../CircularProgressButton';
import type { ModAiJobEntry } from '../../modAiJobsStore';
import s from './ModAiControls.module.scss';

export interface ModAiControlsProps {
  translate: ModAiJobEntry;
  verify: ModAiJobEntry;
  skipDetect: ModAiJobEntry;
  genderDetect: ModAiJobEntry;
  voice: ModAiJobEntry;
  onTranslateTm: () => void;
  onTranslateLlm: () => void;
  onTranslateStop: () => void;
  onVerify: () => void;
  onSkipDetectHeuristic: () => void;
  onSkipDetectWithLlm: () => void;
  onSkipDetectStop: () => void;
  onGenderDetect: () => void;
  onGenderDetectStop: () => void;
  onVoiceMissing: () => void;
  onVoiceAll: () => void;
  onVoiceStop: () => void;
  /** Compact layout for mod list rows. */
  compact?: boolean;
  /** Circular icon buttons with progress ring (mod editor strip). */
  variant?: 'bar' | 'circular';
}

type SlotProps = {
  entry: ModAiJobEntry;
  label: string;
  runningLabel: string;
  idleHint: string;
  icon: string;
  onClick?: () => void;
  menuItems?: CircularProgressButtonMenuItem[];
  onStop?: () => void;
  stoppable?: boolean;
  compact?: boolean;
  circular?: boolean;
};

const progressPct = (done: number, total: number): number | null => {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
};

const formatProgress = (entry: ModAiJobEntry, t: TFunction): string | null => {
  const pct = progressPct(entry.done, entry.total);
  if (pct == null) return null;
  return t('modAi.tooltipProgress', { done: entry.done, total: entry.total, pct });
};

const buildAiJobTooltip = (
  t: TFunction,
  label: string,
  idleHint: string,
  runningLabel: string,
  entry: ModAiJobEntry,
  stoppable = false,
): string => {
  const progress = formatProgress(entry, t);

  switch (entry.status) {
    case 'idle':
      return t('modAi.tooltipIdle', { label, hint: idleHint });
    case 'running':
      if (stoppable) {
        return progress
          ? t('modAi.tooltipRunningWithProgressStop', { label, status: runningLabel, progress })
          : t('modAi.tooltipRunningStop', { label, status: runningLabel });
      }
      return progress
        ? t('modAi.tooltipRunningWithProgress', { label, status: runningLabel, progress })
        : t('modAi.tooltipRunning', { label, status: runningLabel });
    case 'stopping':
      return t('modAi.tooltipStopping', { label });
    case 'completed':
      return progress
        ? t('modAi.tooltipCompleted', { label, progress })
        : t('modAi.tooltipCompletedShort', { label });
    case 'cancelled':
      return progress
        ? t('modAi.tooltipCancelled', { label, progress })
        : t('modAi.tooltipCancelledShort', { label });
    case 'failed':
      return t('modAi.tooltipFailed', {
        label,
        error: entry.error ?? t('modAi.statusFailed'),
      });
    default:
      return t('modAi.tooltipIdle', { label, hint: idleHint });
  }
};

const resolveCircularProgress = (entry: ModAiJobEntry, pct: number | null): number | null => {
  if (pct == null) return null;
  if (entry.status === 'completed') return 100;
  return pct;
};

const resolveCircularTone = (entry: ModAiJobEntry): CircularProgressButtonTone => {
  if (entry.status === 'failed') return 'danger';
  if (entry.status === 'completed') return 'success';
  return 'default';
};

const resolveCircularState = (entry: ModAiJobEntry): CircularProgressButtonState | undefined => {
  if (entry.status === 'running' || entry.status === 'stopping') return 'running';
  if (entry.status === 'completed') return 'completed';
  if (entry.status === 'failed') return 'failed';
  return undefined;
};

const Slot = ({
  entry,
  label,
  runningLabel,
  idleHint,
  icon,
  onClick,
  menuItems,
  onStop,
  stoppable = false,
  compact,
  circular,
}: SlotProps) => {
  const { t } = useTranslation();
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  const isFailed = entry.status === 'failed';
  const isDone =
    entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'failed';
  const pct = progressPct(entry.done, entry.total);
  const tooltip = buildAiJobTooltip(t, label, idleHint, runningLabel, entry, stoppable);
  const useProgressButton = circular || menuItems != null;
  const buttonSize = circular ? 'md' : 'sm';

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

  if (useProgressButton) {
    const sharedProps = {
      icon,
      progress: resolveCircularProgress(entry, pct),
      tone: resolveCircularTone(entry),
      state: resolveCircularState(entry),
      ariaLabel: label,
      title: tooltip,
      size: buttonSize as 'sm' | 'md',
      disabled: entry.status === 'stopping',
    };

    const button =
      menuItems && !isRunning ? (
        <CircularProgressButton {...sharedProps} menuItems={menuItems} />
      ) : (
        <CircularProgressButton {...sharedProps} onClick={onStop ?? onClick ?? (() => {})} />
      );

    return <div className={circular ? s.circularItem : s.menuItem}>{button}</div>;
  }

  let btnClass = s.btn;
  if (isRunning) btnClass += ` ${s.btnRunning}`;
  else if (isFailed) btnClass += ` ${s.btnFailed}`;
  else if (entry.status === 'completed') btnClass += ` ${s.btnCompleted}`;

  return (
    <div className={s.item}>
      <button
        type="button"
        className={btnClass}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
        title={tooltip}
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

/** Per-mod controls for skip-detect, auto-translate, auto-verify, and voice generation with live status. */
export const ModAiControls = ({
  translate,
  verify,
  skipDetect,
  genderDetect,
  voice,
  onTranslateTm,
  onTranslateLlm,
  onTranslateStop,
  onVerify,
  onSkipDetectHeuristic,
  onSkipDetectWithLlm,
  onSkipDetectStop,
  onGenderDetect,
  onGenderDetectStop,
  onVoiceMissing,
  onVoiceAll,
  onVoiceStop,
  compact = false,
  variant = 'bar',
}: ModAiControlsProps) => {
  const { t } = useTranslation();
  const circular = variant === 'circular';

  const skipDetectMenuItems: CircularProgressButtonMenuItem[] = [
    { label: t('modEditor.skipDetectMethodHeuristic'), onClick: onSkipDetectHeuristic },
    { label: t('modEditor.skipDetectMethodBoth'), onClick: onSkipDetectWithLlm },
  ];

  const translateMenuItems: CircularProgressButtonMenuItem[] = [
    { label: t('modEditor.autoTranslateTm'), onClick: onTranslateTm },
    { label: t('modEditor.autoTranslateLlm'), onClick: onTranslateLlm },
  ];

  const voiceMenuItems: CircularProgressButtonMenuItem[] = [
    { label: t('modEditor.aiVoiceGenerateMissing'), onClick: onVoiceMissing },
    { label: t('modEditor.aiVoiceGenerateAll'), onClick: onVoiceAll },
  ];

  const translateRunningLabel =
    translate.translateMode === 'tm'
      ? t('modEditor.autoTranslateTmRunning')
      : t('modEditor.autoTranslateLlmRunning');

  return (
    <div
      className={`${s.bar}${compact ? ` ${s.compact}` : ''}${circular ? ` ${s.circularBar}` : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Slot
        entry={skipDetect}
        label={t('modEditor.skipDetect')}
        runningLabel={t('modEditor.skipDetectRunning')}
        idleHint={t('modAi.hintSkipDetect')}
        icon="⊘"
        menuItems={skipDetectMenuItems}
        onStop={onSkipDetectStop}
        stoppable
        compact={compact}
        circular={circular}
      />
      <Slot
        entry={genderDetect}
        label={t('modEditor.genderDetect')}
        runningLabel={t('modEditor.genderDetectRunning')}
        idleHint={t('modAi.hintGenderDetect')}
        icon="⚧"
        onClick={onGenderDetect}
        onStop={onGenderDetectStop}
        stoppable
        compact={compact}
        circular={circular}
      />
      <Slot
        entry={translate}
        label={t('modEditor.autoTranslate')}
        runningLabel={translateRunningLabel}
        idleHint={t('modAi.hintTranslate')}
        icon="⇄"
        menuItems={translateMenuItems}
        onStop={onTranslateStop}
        stoppable
        compact={compact}
        circular={circular}
      />
      <Slot
        entry={verify}
        label={t('modEditor.aiVerify')}
        runningLabel={t('modEditor.aiVerifyRunning')}
        idleHint={t('modAi.hintVerify')}
        icon="✓"
        onClick={onVerify}
        compact={compact}
        circular={circular}
      />
      <Slot
        entry={voice}
        label={t('modEditor.aiVoiceGenerate')}
        runningLabel={t('modEditor.aiVoiceGenerateRunning')}
        idleHint={t('modAi.hintVoice')}
        icon="🔊"
        menuItems={voiceMenuItems}
        onStop={onVoiceStop}
        stoppable
        compact={compact}
        circular={circular}
      />
    </div>
  );
};
