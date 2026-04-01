import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../api';
import { TopicSidebar } from './components/TopicSidebar';
import { DialogTreeView } from './components/DialogTreeView';
import { SceneSidebar } from './components/SceneSidebar';
import { SceneConversationView } from './components/SceneConversationView';
import { ConversationSidebar } from './components/ConversationSidebar';
import styles from './DialogsMode.module.scss';

/** Which sub-view is active in the Dialogs mode. */
type DialogTab = 'topics' | 'scenes' | 'conversations';

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
 * Two sub-views accessible via tab buttons:
 * - **Topics** — per-DIAL tree view (one speaker per topic).
 * - **Scenes** — per-SCEN conversation view (multi-speaker ordered dialog).
 *
 * Data flow:
 * 1. Fetches all DIAL topics / SCEN scenes for the mod.
 * 2. When the user selects a topic or scene, fetches its content.
 * 3. Passes data down to the appropriate sub-view for rendering.
 */
export const DialogsMode = ({ modId, srcLang, targetLang }: DialogsModeProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DialogTab>('topics');
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  const [selectedConversationKey, setSelectedConversationKey] = useState<string | null>(null);

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
    enabled: tab === 'topics' && effectiveTopicId !== null,
    staleTime: 30_000,
  });

  const nodes = treeQuery.data?.nodes ?? [];
  const edges = treeQuery.data?.edges ?? [];

  // ── Scenes list ──────────────────────────────────────────────────────────

  const scenesQuery = useQuery({
    queryKey: ['dialog-scenes', modId],
    queryFn: () => api.dialogs.scenes(modId),
    staleTime: 60_000,
    enabled: tab === 'scenes',
  });

  const scenes = scenesQuery.data ?? [];
  const effectiveSceneId = selectedSceneId ?? scenes[0]?.scene_id ?? null;

  // ── Dialog lines for selected scene ──────────────────────────────────────

  const sceneQueryKey = ['dialog-scene', effectiveSceneId, srcLang, targetLang] as const;

  const sceneQuery = useQuery({
    queryKey: sceneQueryKey,
    queryFn: () => api.dialogs.sceneDialog(effectiveSceneId!, srcLang, targetLang),
    enabled: tab === 'scenes' && effectiveSceneId !== null,
    staleTime: 30_000,
  });

  const sceneLines = sceneQuery.data ?? [];

  // ── Conversation groups ─────────────────────────────────────────────────

  const conversationsQuery = useQuery({
    queryKey: ['dialog-conversations', modId],
    queryFn: () => api.dialogs.conversations(modId),
    staleTime: 60_000,
    enabled: tab === 'conversations',
  });

  const conversations = conversationsQuery.data ?? [];
  const effectiveConversationKey = selectedConversationKey ?? conversations[0]?.conversation_key ?? null;

  const conversationQueryKey = ['dialog-conversation', modId, effectiveConversationKey, srcLang, targetLang] as const;

  const conversationQuery = useQuery({
    queryKey: conversationQueryKey,
    queryFn: () => api.dialogs.conversationDialog(modId, effectiveConversationKey!, srcLang, targetLang),
    enabled: tab === 'conversations' && effectiveConversationKey !== null,
    staleTime: 30_000,
  });

  const conversationLines = conversationQuery.data ?? [];

  return (
    <div className={styles.root}>
      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'topics' ? styles.activeTab : ''}`}
          onClick={() => setTab('topics')}
        >
          {t('dialogs.tabTopics')}
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'scenes' ? styles.activeTab : ''}`}
          onClick={() => setTab('scenes')}
        >
          {t('dialogs.tabScenes')}
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'conversations' ? styles.activeTab : ''}`}
          onClick={() => setTab('conversations')}
        >
          {t('dialogs.tabConversations')}
        </button>
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className={styles.content}>
        {tab === 'topics' ? (
          <>
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
          </>
        ) : tab === 'scenes' ? (
          <>
            <SceneSidebar
              scenes={scenes}
              activeSceneId={effectiveSceneId}
              isLoading={scenesQuery.isLoading}
              onSelect={setSelectedSceneId}
            />
            <main className={styles.main}>
              {effectiveSceneId === null ? (
                <div className={styles.placeholder}>
                  {scenes.length === 0 && !scenesQuery.isLoading
                    ? t('dialogs.noScenes')
                    : t('dialogs.selectScene')}
                </div>
              ) : (
                <SceneConversationView
                  lines={sceneLines}
                  targetLang={targetLang}
                  queryKey={[...sceneQueryKey]}
                  isLoading={sceneQuery.isLoading}
                />
              )}
            </main>
          </>
        ) : (
          <>
            <ConversationSidebar
              conversations={conversations}
              activeConversationKey={effectiveConversationKey}
              isLoading={conversationsQuery.isLoading}
              onSelect={setSelectedConversationKey}
            />
            <main className={styles.main}>
              {effectiveConversationKey === null ? (
                <div className={styles.placeholder}>
                  {conversations.length === 0 && !conversationsQuery.isLoading
                    ? t('dialogs.noConversations')
                    : t('dialogs.selectConversation')}
                </div>
              ) : (
                <SceneConversationView
                  lines={conversationLines}
                  targetLang={targetLang}
                  queryKey={[...conversationQueryKey]}
                  isLoading={conversationQuery.isLoading}
                  loadingTextKey="dialogs.loadingConversation"
                  emptyTextKey="dialogs.noConversationLines"
                  showSceneBreaks
                />
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
};
