import { useTranslation } from 'react-i18next';
import {
  CircularProgressButton,
  type CircularProgressButtonMenuItem,
  type CircularProgressButtonState,
  type CircularProgressButtonTone,
} from '../../../../../../components/CircularProgressButton';
import type { ModAiJobEntry } from '../../../../../../modAiJobsStore';
import { ProgressPill } from '../../../DialogsMode/components/ProgressPill';
import type { VoiceLineFilter } from '../../hooks/useVoiceState';
import styles from './VoiceLinesView.module.scss';

export interface VoiceLinesHeaderProps {
  speakerName: string;
  dubbed: number;
  total: number;
  /** Lines of {@link total} that have no dialogue record and cannot be dubbed. */
  orphans: number;
  hasReference: boolean;
  filter: VoiceLineFilter;
  onFilterChange: (filter: VoiceLineFilter) => void;
  counts: { total: number; needsTranslation: number; needsVoice: number };
  find: string;
  onFindChange: (value: string) => void;
  hiddenLineCount: number;
  error: string | null;
  onDismissError: () => void;
  isFetching?: boolean;
  voiceJob: ModAiJobEntry;
  voiceProgress: number | null;
  showVoiceProgress: boolean;
  onVoiceMissing: () => void;
  onVoiceAll: () => void;
  onVoiceStop: () => void;
  stressJob: ModAiJobEntry;
  stressProgress: number | null;
  showStressProgress: boolean;
  onStressMissing: () => void;
  onStressAll: () => void;
  onStressStop: () => void;
}

const resolveTone = (entry: ModAiJobEntry): CircularProgressButtonTone => {
  if (entry.status === 'failed') return 'danger';
  if (entry.status === 'completed') return 'success';
  return 'default';
};

const resolveState = (entry: ModAiJobEntry): CircularProgressButtonState | undefined => {
  if (entry.status === 'running' || entry.status === 'stopping') return 'running';
  if (entry.status === 'completed') return 'completed';
  if (entry.status === 'failed') return 'failed';
  return undefined;
};

/** Sticky context bar for the selected speaker's lines. */
export const VoiceLinesHeader = ({
  speakerName,
  dubbed,
  total,
  orphans,
  hasReference,
  filter,
  onFilterChange,
  counts,
  find,
  onFindChange,
  hiddenLineCount,
  error,
  onDismissError,
  isFetching = false,
  voiceJob,
  voiceProgress,
  showVoiceProgress,
  onVoiceMissing,
  onVoiceAll,
  onVoiceStop,
  stressJob,
  stressProgress,
  showStressProgress,
  onStressMissing,
  onStressAll,
  onStressStop,
}: VoiceLinesHeaderProps) => {
  const { t } = useTranslation();
  const dubbable = total - orphans;
  const isVoiceRunning = voiceJob.status === 'running' || voiceJob.status === 'stopping';
  const isStressRunning = stressJob.status === 'running' || stressJob.status === 'stopping';
  const voiceRingProgress =
    voiceJob.status === 'completed' ? 100 : voiceProgress != null ? voiceProgress : null;
  const stressRingProgress =
    stressJob.status === 'completed' ? 100 : stressProgress != null ? stressProgress : null;

  const chips: Array<{ value: VoiceLineFilter; count: number }> = [
    { value: 'all', count: counts.total },
    { value: 'needsTranslation', count: counts.needsTranslation },
    { value: 'needsVoice', count: counts.needsVoice },
  ];

  const voiceMenuItems: CircularProgressButtonMenuItem[] = [
    { label: t('modEditor.aiVoiceGenerateMissing'), onClick: onVoiceMissing },
    { label: t('modEditor.aiVoiceGenerateAll'), onClick: onVoiceAll },
  ];

  const stressMenuItems: CircularProgressButtonMenuItem[] = [
    { label: t('modEditor.aiStressPlaceMissing'), onClick: onStressMissing },
    { label: t('modEditor.aiStressPlaceAll'), onClick: onStressAll },
  ];

  let voiceStatus: string | null = null;
  if (voiceJob.status === 'stopping') {
    voiceStatus = t('modAi.statusStopping');
  } else if (isVoiceRunning) {
    voiceStatus =
      voiceJob.total > 0
        ? t('modAi.progressShort', { done: voiceJob.done, total: voiceJob.total })
        : t('modEditor.aiVoiceGenerateRunning');
  } else if (voiceJob.status === 'failed' && voiceJob.error) {
    voiceStatus = voiceJob.error;
  }

  let stressStatus: string | null = null;
  if (stressJob.status === 'stopping') {
    stressStatus = t('modAi.statusStopping');
  } else if (isStressRunning) {
    stressStatus =
      stressJob.total > 0
        ? t('modAi.progressShort', { done: stressJob.done, total: stressJob.total })
        : t('modEditor.aiStressPlaceRunning');
  } else if (stressJob.status === 'failed' && stressJob.error) {
    stressStatus = stressJob.error;
  }

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{speakerName}</h2>
        <span className={styles.subtitle}>{t('voice.linesSubtitle', { count: total })}</span>
        {orphans > 0 && (
          <span className={styles.subtitle} title={t('modEditor.voiceOrphanTitle')}>
            {t('voice.orphanLines', { count: orphans })}
          </span>
        )}
        <span className={styles.headerSpacer} />
        {isFetching && <span className={styles.fetching}>{t('modEditor.voiceLoading')}</span>}
        {voiceStatus && <span className={styles.voiceStatus}>{voiceStatus}</span>}
        {isVoiceRunning ? (
          <CircularProgressButton
            icon="♫"
            progress={voiceRingProgress}
            tone={resolveTone(voiceJob)}
            state={resolveState(voiceJob)}
            ariaLabel={t('voice.generateSpeaker')}
            title={t('modEditor.aiVoiceGenerateRunning')}
            size="sm"
            disabled={voiceJob.status === 'stopping'}
            onClick={onVoiceStop}
          />
        ) : (
          <CircularProgressButton
            icon="♫"
            progress={voiceRingProgress}
            tone={resolveTone(voiceJob)}
            state={resolveState(voiceJob)}
            ariaLabel={t('voice.generateSpeaker')}
            title={t('voice.generateSpeakerTitle')}
            size="sm"
            menuItems={voiceMenuItems}
          />
        )}
        {stressStatus && <span className={styles.voiceStatus}>{stressStatus}</span>}
        {isStressRunning ? (
          <CircularProgressButton
            icon="´"
            progress={stressRingProgress}
            tone={resolveTone(stressJob)}
            state={resolveState(stressJob)}
            ariaLabel={t('voice.stressSpeaker')}
            title={t('modEditor.aiStressPlaceRunning')}
            size="sm"
            disabled={stressJob.status === 'stopping'}
            onClick={onStressStop}
          />
        ) : (
          <CircularProgressButton
            icon="´"
            progress={stressRingProgress}
            tone={resolveTone(stressJob)}
            state={resolveState(stressJob)}
            ariaLabel={t('voice.stressSpeaker')}
            title={t('voice.stressSpeakerTitle')}
            size="sm"
            menuItems={stressMenuItems}
          />
        )}
        <ProgressPill
          done={dubbed}
          total={dubbable}
          showCount
          title={t('voice.dubbedProgress', { done: dubbed, total: dubbable })}
        />
      </div>

      {showVoiceProgress && (
        <div
          className={styles.jobProgress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={voiceRingProgress ?? 0}
          aria-label={t('voice.generateSpeaker')}
        >
          <div
            className={`${styles.jobProgressFill}${voiceJob.status === 'failed' ? ` ${styles.jobProgressFailed}` : ''}${voiceJob.status === 'completed' ? ` ${styles.jobProgressDone}` : ''}`}
            style={{ width: `${voiceRingProgress ?? (isVoiceRunning ? 8 : 0)}%` }}
          />
        </div>
      )}

      {showStressProgress && (
        <div
          className={styles.jobProgress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stressRingProgress ?? 0}
          aria-label={t('voice.stressSpeaker')}
        >
          <div
            className={`${styles.jobProgressFill}${stressJob.status === 'failed' ? ` ${styles.jobProgressFailed}` : ''}${stressJob.status === 'completed' ? ` ${styles.jobProgressDone}` : ''}`}
            style={{ width: `${stressRingProgress ?? (isStressRunning ? 8 : 0)}%` }}
          />
        </div>
      )}

      <div className={styles.controlRow}>
        <div className={styles.chips} role="group" aria-label={t('voice.filterLabel')}>
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`${styles.chip} ${filter === chip.value ? styles.chipActive : ''}`}
              onClick={() => onFilterChange(chip.value)}
            >
              {t(`voice.filter.${chip.value}`)}
              <span className={styles.chipCount}>{chip.count}</span>
            </button>
          ))}
        </div>

        <input
          className={styles.find}
          value={find}
          onChange={(event) => onFindChange(event.target.value)}
          placeholder={t('voice.findPlaceholder')}
          aria-label={t('voice.findPlaceholder')}
        />
      </div>

      <p className={styles.refHint}>
        {hasReference ? t('modEditor.voiceRefHint') : t('modEditor.voiceRefHintEmpty')}
      </p>

      {hiddenLineCount > 0 && (
        <p className={styles.hiddenNote}>{t('voice.hiddenLines', { count: hiddenLineCount })}</p>
      )}

      {error && (
        <p className={styles.error} onClick={onDismissError} role="alert">
          {error}
        </p>
      )}
    </header>
  );
};
