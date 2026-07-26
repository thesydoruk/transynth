import { useTranslation } from 'react-i18next';
import { ProgressPill } from '../../../DialogsMode/components/ProgressPill';
import type { VoiceLineFilter } from '../../hooks/useVoiceState';
import styles from './VoiceLinesView.module.scss';

export interface VoiceLinesHeaderProps {
  speakerName: string;
  dubbed: number;
  total: number;
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
}

/** Sticky context bar for the selected speaker's lines. */
export const VoiceLinesHeader = ({
  speakerName,
  dubbed,
  total,
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
}: VoiceLinesHeaderProps) => {
  const { t } = useTranslation();

  const chips: Array<{ value: VoiceLineFilter; count: number }> = [
    { value: 'all', count: counts.total },
    { value: 'needsTranslation', count: counts.needsTranslation },
    { value: 'needsVoice', count: counts.needsVoice },
  ];

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{speakerName}</h2>
        <span className={styles.subtitle}>{t('voice.linesSubtitle', { count: total })}</span>
        <span className={styles.headerSpacer} />
        {isFetching && <span className={styles.fetching}>{t('modEditor.voiceLoading')}</span>}
        <ProgressPill
          done={dubbed}
          total={total}
          showCount
          title={t('voice.dubbedProgress', { done: dubbed, total })}
        />
      </div>

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
