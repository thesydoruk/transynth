import { useTranslation } from 'react-i18next';
import { type SceneDialogLine } from '../../../../../../api';
import { SceneLineCard } from './SceneLineCard';
import styles from './SceneConversationView.module.scss';

/** Props for the scene conversation view. */
export interface SceneConversationViewProps {
  /** Ordered dialog lines for the selected scene. */
  lines: SceneDialogLine[];
  /** Target language code — used when saving a translation. */
  targetLang: string;
  /** React Query key array to invalidate after save. */
  queryKey: unknown[];
  /** Whether scene dialog data is still loading. */
  isLoading: boolean;
  /** Translation key used for the loading placeholder. */
  loadingTextKey?: string;
  /** Translation key used for the empty placeholder. */
  emptyTextKey?: string;
  /** Whether to show separators when the scene changes inside a stitched stream. */
  showSceneBreaks?: boolean;
}

/**
 * Renders the dialog content of a single SCEN scene as a flat,
 * chronologically-ordered conversation.  Each phase maps to one or more
 * dialog lines, showing the speaker, source text, current translation,
 * and an inline editor.
 */
export const SceneConversationView = ({
  lines,
  targetLang,
  queryKey,
  isLoading,
  loadingTextKey = 'dialogs.loadingScene',
  emptyTextKey = 'dialogs.noSceneLines',
  showSceneBreaks = false,
}: SceneConversationViewProps) => {
  const { t } = useTranslation();

  if (isLoading) {
    return <div className={styles.info}>{t(loadingTextKey)}</div>;
  }

  if (lines.length === 0) {
    return <div className={styles.info}>{t(emptyTextKey)}</div>;
  }

  return (
    <div className={styles.conversation}>
      {lines.map((line, idx) => (
        <div key={`${line.scene_id}-${line.phase_order}-${line.node_id ?? line.info_formid_hex ?? line.topic_formid_hex}`} className={styles.lineWrap}>
          {showSceneBreaks && (idx === 0 || lines[idx - 1].scene_id !== line.scene_id) && (
            <div className={styles.sceneMarker}>
              {t('dialogs.sceneMarker', { label: line.scene_edid ?? line.scene_formid_hex })}
            </div>
          )}
          <SceneLineCard
            line={line}
            targetLang={targetLang}
            queryKey={queryKey}
          />
        </div>
      ))}
    </div>
  );
};
