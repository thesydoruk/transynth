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
      {topics.map((topic) => (
        <button
          key={topic.topic_id}
          type="button"
          className={`${styles.topicRow} ${topic.topic_id === activeTopicId ? styles.active : ''}`}
          onClick={() => onSelect(topic.topic_id)}
          title={topic.topic_formid_hex}
        >
          <span className={styles.topicLabel}>
            {topic.topic_edid ?? topic.topic_formid_hex}
          </span>
          <span className={styles.nodeBadge}>{topic.node_count}</span>
        </button>
      ))}
    </aside>
  );
};
