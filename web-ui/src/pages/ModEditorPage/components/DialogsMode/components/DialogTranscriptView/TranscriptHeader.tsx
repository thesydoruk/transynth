import { useTranslation } from 'react-i18next';
import type { TranscriptFilter } from '../../hooks/useDialogsState';
import type { FillMode } from '../../hooks/useTranscriptFill';
import { ProgressPill } from '../ProgressPill';
import styles from './DialogTranscriptView.module.scss';

export interface TranscriptHeaderProps {
  label: string;
  sublabel: string | null;
  counts: { total: number; translated: number; qa: number };
  filter: TranscriptFilter;
  onFilterChange: (filter: TranscriptFilter) => void;
  find: string;
  onFindChange: (value: string) => void;
  /** Entries removed by the active filter or search. */
  hiddenEntryCount: number;
  onNextTodo: () => void;
  /** Runs TM or the LLM over every untranslated line of the transcript. */
  onFill: (mode: FillMode) => void;
  fillProgress: { done: number; total: number } | null;
  isFetching: boolean;
  /** Ready-to-render failure notice; clicking it dismisses the notice. */
  error: string | null;
  onDismissError: () => void;
}

/**
 * Sticky context bar of the transcript: what is open, how far it is, and the
 * filters that narrow it down to the lines still needing work.
 */
export const TranscriptHeader = ({
  label,
  sublabel,
  counts,
  filter,
  onFilterChange,
  find,
  onFindChange,
  hiddenEntryCount,
  onNextTodo,
  onFill,
  fillProgress,
  isFetching,
  error,
  onDismissError,
}: TranscriptHeaderProps) => {
  const { t } = useTranslation();
  const todo = counts.total - counts.translated;

  const chips: Array<{ value: TranscriptFilter; count: number | null }> = [
    { value: 'all', count: counts.total },
    { value: 'todo', count: todo },
    { value: 'qa', count: counts.qa },
  ];

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{label}</h2>
        {sublabel && <span className={styles.subtitle}>{sublabel}</span>}
        <span className={styles.headerSpacer} />
        {isFetching && <span className={styles.fetching}>{t('dialogs.loadingTranscript')}</span>}
        <ProgressPill
          done={counts.translated}
          total={counts.total}
          showCount
          title={t('dialogs.progressTitle', { done: counts.translated, total: counts.total })}
        />
      </div>

      <div className={styles.controlRow}>
        <div className={styles.chips} role="group" aria-label={t('dialogs.filterLabel')}>
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`${styles.chip} ${filter === chip.value ? styles.chipActive : ''}`}
              onClick={() => onFilterChange(chip.value)}
            >
              {t(`dialogs.filter.${chip.value}`)}
              <span className={styles.chipCount}>{chip.count}</span>
            </button>
          ))}
        </div>

        <input
          className={styles.find}
          value={find}
          onChange={(event) => onFindChange(event.target.value)}
          placeholder={t('dialogs.findPlaceholder')}
          aria-label={t('dialogs.findPlaceholder')}
        />

        <button
          type="button"
          className={styles.action}
          onClick={onNextTodo}
          disabled={todo === 0}
          title={t('dialogs.nextTodoTitle')}
        >
          {t('dialogs.nextTodo')}
        </button>

        {fillProgress ? (
          <span className={styles.fillProgress}>
            {t('dialogs.filling', { done: fillProgress.done, total: fillProgress.total })}
          </span>
        ) : (
          <>
            <button
              type="button"
              className={styles.action}
              onClick={() => onFill('tm')}
              disabled={todo === 0}
              title={t('dialogs.fillTmTitle')}
            >
              {t('dialogs.fillTm')}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => onFill('llm')}
              disabled={todo === 0}
              title={t('dialogs.fillLlmTitle')}
            >
              {t('dialogs.fillLlm')}
            </button>
          </>
        )}
      </div>

      {hiddenEntryCount > 0 && (
        <p className={styles.hiddenNote}>
          {t('dialogs.hiddenEntries', { count: hiddenEntryCount })}
        </p>
      )}

      {error && (
        <p className={styles.error} onClick={onDismissError} role="alert">
          {error}
        </p>
      )}
    </header>
  );
};
