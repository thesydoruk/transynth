import { useTranslation } from 'react-i18next';
import type { DialogEntry } from '../../../../../../api';
import { DialogEntryCard } from './DialogEntryCard';
import { TranscriptHeader, type TranscriptHeaderProps } from './TranscriptHeader';
import type { DialogLineHandlers } from './transcriptTypes';
import styles from './DialogTranscriptView.module.scss';

export interface DialogTranscriptViewProps {
  header: TranscriptHeaderProps;
  /** Entries left after the header filters were applied. */
  entries: DialogEntry[];
  handlers: DialogLineHandlers;
  isLoading: boolean;
  /** Replaces the whole view when there is nothing to select. */
  emptyMessage: string | null;
}

/**
 * Right column of the dialogs editor: the ordered dialog of the selected group,
 * with its context bar and keyboard reference.
 */
export const DialogTranscriptView = ({
  header,
  entries,
  handlers,
  isLoading,
  emptyMessage,
}: DialogTranscriptViewProps) => {
  const { t } = useTranslation();

  if (emptyMessage) {
    return (
      <section className={styles.transcript}>
        <p className={styles.placeholder}>{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section className={styles.transcript}>
      <TranscriptHeader {...header} />

      <div className={styles.stream}>
        {isLoading ? (
          <p className={styles.placeholder}>{t('dialogs.loadingTranscript')}</p>
        ) : entries.length === 0 ? (
          <p className={styles.placeholder}>{t('dialogs.noLines')}</p>
        ) : (
          entries.map((entry) => (
            <DialogEntryCard key={entry.id} entry={entry} handlers={handlers} />
          ))
        )}
      </div>

      <footer className={styles.hints}>{t('dialogs.hotkeyHint')}</footer>
    </section>
  );
};
