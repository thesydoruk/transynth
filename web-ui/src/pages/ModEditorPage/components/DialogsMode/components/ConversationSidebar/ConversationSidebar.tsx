import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DialogConversation } from '../../../../../../api';
import styles from './ConversationSidebar.module.scss';

/** Props for the stitched conversation list sidebar. */
export interface ConversationSidebarProps {
  /** Grouped conversation rows for the active mod. */
  conversations: DialogConversation[];
  /** Currently selected conversation key, or null when none. */
  activeConversationKey: string | null;
  /** Whether conversation data is still loading. */
  isLoading: boolean;
  /** Called when the user selects a conversation. */
  onSelect: (conversationKey: string) => void;
}

/**
 * Sidebar listing stitched conversation groups. Conversations are built by
 * grouping quest-owned scenes into one higher-level dialog flow.
 */
export const ConversationSidebar = ({
  conversations,
  activeConversationKey,
  isLoading,
  onSelect,
}: ConversationSidebarProps) => {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filteredConversations = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((conversation) => {
      const label = conversation.quest_formid_hex
        ? t('dialogs.conversationQuestLabel', { formId: conversation.quest_formid_hex })
        : (conversation.sample_scene_edid ?? conversation.sample_scene_formid_hex);
      return (
        label.toLowerCase().includes(q)
        || conversation.conversation_key.toLowerCase().includes(q)
        || (conversation.quest_formid_hex?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [conversations, filterText, t]);

  const activeIndex = activeConversationKey === null
    ? -1
    : filteredConversations.findIndex((conversation) => conversation.conversation_key === activeConversationKey);
  const safeHighlightedIndex = filteredConversations.length === 0
    ? 0
    : Math.min(highlightedIndex, filteredConversations.length - 1);
  const highlightedConversationKey = activeIndex >= 0
    ? filteredConversations[activeIndex].conversation_key
    : filteredConversations[safeHighlightedIndex]?.conversation_key;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredConversations.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredConversations.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(filteredConversations[safeHighlightedIndex].conversation_key);
    }
  }, [filteredConversations, safeHighlightedIndex, onSelect]);

  if (isLoading) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.loading}>{t('dialogs.loadingConversations')}</div>
      </aside>
    );
  }

  if (conversations.length === 0) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.empty}>{t('dialogs.noConversations')}</div>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>{t('dialogs.conversationsHeader')}</div>
      <div className={styles.filterWrap}>
        <input
          className={styles.filterInput}
          value={filterText}
          onChange={(e) => { setFilterText(e.target.value); setHighlightedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder={t('dialogs.conversationsFilterPlaceholder')}
          aria-label={t('dialogs.conversationsFilterPlaceholder')}
        />
      </div>

      {filteredConversations.length === 0 ? (
        <div className={styles.empty}>{t('dialogs.noConversationsMatch')}</div>
      ) : (
        filteredConversations.map((conversation) => {
          const label = conversation.quest_formid_hex
            ? t('dialogs.conversationQuestLabel', { formId: conversation.quest_formid_hex })
            : (conversation.sample_scene_edid ?? conversation.sample_scene_formid_hex);
          return (
            <button
              key={conversation.conversation_key}
              type="button"
              className={`${styles.row} ${conversation.conversation_key === activeConversationKey ? styles.active : ''} ${conversation.conversation_key === highlightedConversationKey ? styles.highlighted : ''}`}
              onClick={() => onSelect(conversation.conversation_key)}
              title={conversation.conversation_key}
            >
              <span className={styles.label}>{label}</span>
              <span className={styles.badge}>{conversation.phase_count}</span>
            </button>
          );
        })
      )}

      <div className={styles.hint}>{t('dialogs.topicsKeyboardHint')}</div>
    </aside>
  );
};