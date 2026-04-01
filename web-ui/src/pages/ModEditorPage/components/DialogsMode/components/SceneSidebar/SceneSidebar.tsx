import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DialogScene } from '../../../../../../api';
import styles from './SceneSidebar.module.scss';

/** Props for the scene list sidebar. */
export interface SceneSidebarProps {
  /** List of SCEN scenes for the active mod. */
  scenes: DialogScene[];
  /** Currently selected scene id, or null when none. */
  activeSceneId: number | null;
  /** Whether scene data is still loading. */
  isLoading: boolean;
  /** Called when the user selects a scene. */
  onSelect: (sceneId: number) => void;
}

/**
 * Narrow left sidebar that lists all SCEN scenes for the mod.
 *
 * Each row shows the scene EDID (or its FormID hex as fallback) and a
 * badge with the number of phases inside the scene.  Clicking a row
 * calls {@link SceneSidebarProps.onSelect} with the scene's numeric id.
 */
export const SceneSidebar = ({ scenes, activeSceneId, isLoading, onSelect }: SceneSidebarProps) => {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filteredScenes = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return scenes;
    return scenes.filter((scene) => {
      const label = scene.scene_edid ?? '';
      return (
        label.toLowerCase().includes(q)
        || scene.scene_formid_hex.toLowerCase().includes(q)
      );
    });
  }, [scenes, filterText]);

  const activeIndex = activeSceneId === null
    ? -1
    : filteredScenes.findIndex((scene) => scene.scene_id === activeSceneId);
  const safeHighlightedIndex = filteredScenes.length === 0
    ? 0
    : Math.min(highlightedIndex, filteredScenes.length - 1);
  const highlightedSceneId = activeIndex >= 0
    ? filteredScenes[activeIndex].scene_id
    : filteredScenes[safeHighlightedIndex]?.scene_id;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredScenes.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, filteredScenes.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(filteredScenes[safeHighlightedIndex].scene_id);
    }
  }, [filteredScenes, safeHighlightedIndex, onSelect]);

  if (isLoading) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.loading}>{t('dialogs.loadingScenes')}</div>
      </aside>
    );
  }

  if (scenes.length === 0) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.empty}>{t('dialogs.noScenes')}</div>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>{t('dialogs.scenesHeader')}</div>
      <div className={styles.filterWrap}>
        <input
          className={styles.filterInput}
          value={filterText}
          onChange={(e) => { setFilterText(e.target.value); setHighlightedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder={t('dialogs.scenesFilterPlaceholder')}
          aria-label={t('dialogs.scenesFilterPlaceholder')}
        />
      </div>

      {filteredScenes.length === 0 ? (
        <div className={styles.empty}>{t('dialogs.noScenesMatch')}</div>
      ) : (
        filteredScenes.map((scene) => (
          <button
            key={scene.scene_id}
            type="button"
            className={`${styles.sceneRow} ${scene.scene_id === activeSceneId ? styles.active : ''} ${scene.scene_id === highlightedSceneId ? styles.highlighted : ''}`}
            onClick={() => onSelect(scene.scene_id)}
            title={scene.scene_formid_hex}
          >
            <span className={styles.sceneLabel}>
              {scene.scene_edid ?? scene.scene_formid_hex}
            </span>
            <span className={styles.phaseBadge}>{scene.phase_count}</span>
          </button>
        ))
      )}

      <div className={styles.hint}>{t('dialogs.topicsKeyboardHint')}</div>
    </aside>
  );
};
