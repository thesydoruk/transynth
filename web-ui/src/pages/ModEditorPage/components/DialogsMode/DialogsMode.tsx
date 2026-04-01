import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../api';
import { TopicSidebar } from './components/TopicSidebar';
import { DialogTreeView } from './components/DialogTreeView';
import styles from './DialogsMode.module.scss';

/** Props for the Dialogs mode view. */
export interface DialogsModeProps {
  /** Numeric id of the currently open mod. */
  modId: number;
  /** Source language code (used for string resolution). */
  srcLang: string;
  /** Target language code (used for translation save/load). */
  targetLang: string;
}

/**
 * Full–page view for the "Dialogs" editor mode.
 *
 * Layout: narrow left sidebar (topic list) + scrollable main area (tree).
 *
 * Data flow:
 * 1. Fetches all DIAL topics for the mod via {@link api.dialogs.topics}.
 * 2. When the user selects a topic, fetches the tree for that topic via
 *    {@link api.dialogs.tree}.
 * 3. Passes nodes + edges down to {@link DialogTreeView} for rendering.
 */
export const DialogsMode = ({ modId, srcLang, targetLang }: DialogsModeProps) => {
  const { t } = useTranslation();
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);

  // ── Topics list ──────────────────────────────────────────────────────────

  const topicsQuery = useQuery({
    queryKey: ['dialog-topics', modId],
    queryFn: () => api.dialogs.topics(modId),
    staleTime: 60_000,
  });

  const topics = topicsQuery.data ?? [];
  const effectiveTopicId = selectedTopicId ?? topics[0]?.topic_id ?? null;

  // ── Tree for selected topic ──────────────────────────────────────────────

  const treeQueryKey = ['dialog-tree', effectiveTopicId, srcLang, targetLang] as const;

  const treeQuery = useQuery({
    queryKey: treeQueryKey,
    queryFn: () => api.dialogs.tree(effectiveTopicId!, srcLang, targetLang),
    enabled: effectiveTopicId !== null,
    staleTime: 30_000,
  });

  const nodes = treeQuery.data?.nodes ?? [];
  const edges = treeQuery.data?.edges ?? [];

  return (
    <div className={styles.root}>
      <TopicSidebar
        topics={topics}
        activeTopicId={effectiveTopicId}
        isLoading={topicsQuery.isLoading}
        onSelect={setSelectedTopicId}
      />

      <main className={styles.main}>
        {effectiveTopicId === null ? (
          <div className={styles.placeholder}>
            {topics.length === 0 && !topicsQuery.isLoading
              ? t('dialogs.noDialogData')
              : t('dialogs.selectTopic')}
          </div>
        ) : (
          <DialogTreeView
            nodes={nodes}
            edges={edges}
            targetLang={targetLang}
            queryKey={[...treeQueryKey]}
            isLoading={treeQuery.isLoading}
          />
        )}
      </main>
    </div>
  );
};
