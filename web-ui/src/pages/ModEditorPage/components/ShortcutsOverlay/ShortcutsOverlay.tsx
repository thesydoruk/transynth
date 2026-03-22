import { useTranslation } from 'react-i18next';
import styles from './ShortcutsOverlay.module.scss';

/** Props for the keyboard-shortcuts help overlay. */
export interface ShortcutsOverlayProps {
  /** Callback to close the overlay. */
  onClose: () => void;
}

/**
 * Full-screen backdrop with a centred card listing every keyboard shortcut
 * available in the mod-editor grid.  Clicking outside the card closes it.
 */
export const ShortcutsOverlay = ({ onClose }: ShortcutsOverlayProps) => {
  const { t } = useTranslation();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{t('modEditor.shortcuts')}</div>
        <table className={styles.table}>
          <tbody>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>{t('modEditor.shortcutSave')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd></td><td>{t('modEditor.shortcutApprove')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd></td><td>{t('modEditor.shortcutReject')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd></td><td>{t('modEditor.shortcutCopySource')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd></td><td>{t('modEditor.shortcutClear')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>{t('modEditor.shortcutToggleDetail')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>↑</kbd> <kbd>↓</kbd></td><td>{t('modEditor.shortcutNavRows')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>N</kbd></td><td>{t('modEditor.shortcutNextUntranslated')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Q</kbd></td><td>{t('modEditor.shortcutNextQaIssue')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Enter</kbd></td><td>{t('modEditor.shortcutFocusTextarea')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Space</kbd></td><td>{t('modEditor.shortcutToggleSelect')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>A</kbd></td><td>{t('modEditor.shortcutSelectAll')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>PgDn</kbd> <kbd>PgUp</kbd></td><td>{t('modEditor.shortcutPageNav')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>Esc</kbd></td><td>{t('modEditor.shortcutEscape')}</td></tr>
            <tr><td className={styles.kbdCell}><kbd>?</kbd></td><td>{t('modEditor.shortcuts')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
