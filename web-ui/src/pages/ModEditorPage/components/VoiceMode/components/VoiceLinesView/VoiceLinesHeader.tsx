import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../../../api';
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
}

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
}: VoiceLinesHeaderProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const dubbable = total - orphans;

  const { data: projectSettings } = useQuery({
    queryKey: ['projectSettings'],
    queryFn: () => api.projectSettings.getAll() as Promise<{ 'voice.uk_library'?: boolean }>,
    staleTime: 30_000,
  });
  const ukLibraryOn = projectSettings?.['voice.uk_library'] !== false;

  const { mutate: updateUkLibrary, isPending: ukLibraryPending } = useMutation({
    mutationFn: (value: boolean) => api.projectSettings.update('voice.uk_library', value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projectSettings'] });
    },
  });

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
        {orphans > 0 && (
          <span className={styles.subtitle} title={t('modEditor.voiceOrphanTitle')}>
            {t('voice.orphanLines', { count: orphans })}
          </span>
        )}
        <span className={styles.headerSpacer} />
        {isFetching && <span className={styles.fetching}>{t('modEditor.voiceLoading')}</span>}
        <ProgressPill
          done={dubbed}
          total={dubbable}
          showCount
          title={t('voice.dubbedProgress', { done: dubbed, total: dubbable })}
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

        <label className={styles.libraryToggle} title={t('voice.ukLibraryDesc')}>
          <span className={styles.libraryToggleLabel}>{t('voice.ukLibrary')}</span>
          <span className={styles.toggle}>
            <input
              type="checkbox"
              checked={ukLibraryOn}
              disabled={ukLibraryPending}
              onChange={() => updateUkLibrary(!ukLibraryOn)}
              aria-label={t('voice.ukLibrary')}
            />
            <span className={styles.toggleTrack} />
          </span>
        </label>

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
