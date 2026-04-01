import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DialogTopic } from '../../../../../../api';
import styles from './TopicSidebar.module.scss';

/** Props for the topic list sidebar. */
export interface TopicSidebarProps {
  /** List of DIAL topics for the active mod. */
  topics: DialogTopic[];
  /** Currently selected topic id, or null when none. */
  activeTopicId: number | null;
  /** Whether topic data is still loading. */
  isLoading: boolean;
  /** Called when the user selects a topic. */
  onSelect: (topicId: number) => void;
}

/**
 * Narrow left sidebar that lists all DIAL topics for the mod.
 *
 * Each row shows the topic EDID (or its FormID hex as fallback) and a
 * badge with the number of INFO nodes inside the topic.  Clicking a row
 * calls {@link TopicSidebarProps.onSelect} with the topic's numeric id.
 */
export const TopicSidebar = ({ topics, activeTopicId, isLoading, onSelect }: TopicSidebarProps) => {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filteredTopics = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((topic) => {
      const label = topic.topic_edid ?? '';
      return (
        label.toLowerCase().includes(q)
        || topic.topic_formid_hex.toLowerCase().includes(q)
      );
    });
  }, [topics, filterText]);

  const activeIndex = activeTopicId === null
    ? -1
    : filteredTopics.findIndex((topic) => topic.topic_id === activeTopicId);
  const safeHighlightedIndex = filteredTopics.length === 0
    ? 0
    : Math.min(highlightedIndex, filteredTopics.length - 1);
  const highlightedTopicId = activeIndex >= 0
    ? filteredTopics[activeIndex].topic_id
    : filteredTopics[safeHighlightedIndex]?.topic_id;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredTopics.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredTopics.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(filteredTopics[safeHighlightedIndex].topic_id);
    }
  }, [filteredTopics, safeHighlightedIndex, onSelect]);

  if (isLoading) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.loading}>{t('dialogs.loadingTopics')}</div>
      </aside>
    );
  }

  if (topics.length === 0) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.empty}>{t('dialogs.noTopics')}</div>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>{t('dialogs.topicsHeader')}</div>
      <div className={styles.filterWrap}>
        <input
          className={styles.filterInput}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('dialogs.topicsFilterPlaceholder')}
          aria-label={t('dialogs.topicsFilterPlaceholder')}
        />
      </div>

      {filteredTopics.length === 0 ? (
        <div className={styles.empty}>{t('dialogs.noTopicsMatch')}</div>
      ) : (
        filteredTopics.map((topic) => (
          <button
            key={topic.topic_id}
            type="button"
            className={`${styles.topicRow} ${topic.topic_id === activeTopicId ? styles.active : ''} ${topic.topic_id === highlightedTopicId ? styles.highlighted : ''}`}
            onClick={() => onSelect(topic.topic_id)}
            title={topic.topic_formid_hex}
          >
            <span className={styles.topicLabel}>
              {topic.topic_edid ?? topic.topic_formid_hex}
            </span>
            <span className={styles.nodeBadge}>{topic.node_count}</span>
          </button>
        ))
      )}

      <div className={styles.hint}>{t('dialogs.topicsKeyboardHint')}</div>
    </aside>
  );
};
