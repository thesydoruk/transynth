import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogEntry } from '../../../../../../api';
import {
  buildTranscriptGuides,
  entryHasChildren,
  visibleTranscriptEntries,
} from '../../transcriptTree';
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
 * Right column of the dialogs editor: the branching dialog of the selected
 * node, with tree guides, a context bar, and keyboard reference.
 */
export const DialogTranscriptView = ({
  header,
  entries,
  handlers,
  isLoading,
  emptyMessage,
}: DialogTranscriptViewProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const visible = useMemo(() => visibleTranscriptEntries(entries, collapsed), [entries, collapsed]);
  const guides = useMemo(() => buildTranscriptGuides(visible), [visible]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        ) : visible.length === 0 ? (
          <p className={styles.placeholder}>{t('dialogs.noLines')}</p>
        ) : (
          visible.map((entry, index) => (
            <DialogEntryCard
              key={entry.id}
              entry={entry}
              guide={guides[index]}
              hasChildren={entryHasChildren(visible, index) || collapsed.has(entry.id)}
              collapsed={collapsed.has(entry.id)}
              onToggleCollapse={() => toggleCollapse(entry.id)}
              handlers={handlers}
            />
          ))
        )}
      </div>

      <footer className={styles.hints}>{t('dialogs.hotkeyHint')}</footer>
    </section>
  );
};
