import { useTranslation } from 'react-i18next';
import styles from './EditorToolbar.module.scss';

/** The two editing surfaces of the mod editor. */
export type EditorPageMode = 'strings' | 'dialogs';

export interface EditorModeSwitchProps {
  mode: EditorPageMode;
  onChange: (mode: EditorPageMode) => void;
}

const MODES: EditorPageMode[] = ['strings', 'dialogs'];

/**
 * Segmented switch between the strings grid and the dialogs editor.
 *
 * Both options stay visible so the current surface is readable at a glance,
 * unlike a single toggle button whose label only hints at the other side.
 */
export const EditorModeSwitch = ({ mode, onChange }: EditorModeSwitchProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.modeSwitch} role="group" aria-label={t('modEditor.modeLabel')}>
      {MODES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          className={`${styles.modeButton} ${mode === value ? styles.modeButtonActive : ''}`}
          onClick={() => onChange(value)}
          title={t(`modEditor.mode.${value}Title`)}
        >
          {t(`modEditor.mode.${value}`)}
        </button>
      ))}
    </div>
  );
};
