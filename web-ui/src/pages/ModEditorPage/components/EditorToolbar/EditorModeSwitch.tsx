import { useTranslation } from 'react-i18next';
import styles from './EditorToolbar.module.scss';

/** The editing surfaces of the mod editor. */
export type EditorPageMode = 'voice' | 'strings' | 'dialogs';

export interface EditorModeSwitchProps {
  mode: EditorPageMode;
  onChange: (mode: EditorPageMode) => void;
  /** Modes to show (defaults to strings / dialogs / voice). */
  modes?: EditorPageMode[];
}

const DEFAULT_MODES: EditorPageMode[] = ['strings', 'dialogs', 'voice'];

/**
 * Segmented switch between voice, strings grid, and dialogs editor.
 *
 * Both options stay visible so the current surface is readable at a glance,
 * unlike a single toggle button whose label only hints at the other side.
 */
export const EditorModeSwitch = ({
  mode,
  onChange,
  modes = DEFAULT_MODES,
}: EditorModeSwitchProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.modeSwitch} role="group" aria-label={t('modEditor.modeLabel')}>
      {modes.map((value) => (
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
