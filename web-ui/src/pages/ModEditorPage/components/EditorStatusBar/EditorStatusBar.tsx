import { useTranslation } from 'react-i18next';
import type { StringRow } from '../../../../api';
import {
  editorCapabilities,
  formatDiscoPoKey,
  type EditorCapabilities,
} from '../../editorCapabilities';
import { resolvePexScriptContext } from '../DetailPanel/utils';
import styles from './EditorStatusBar.module.scss';

/** Mod-level statistics shown in the status bar. */
export interface ModStats {
  approved: number;
  draft: number;
  rejected: number;
  tm: number;
  fuzzy: number;
  auto_translated: number;
  skipped: number;
  untranslated: number;
  total: number;
}

/** Props for the bottom status bar of the mod editor. */
export interface EditorStatusBarProps {
  /** Number of currently selected rows. */
  selectedCount: number;
  /** The row currently focused in the detail panel (if any). */
  activeRow: StringRow | null;
  /** Aggregated translation statistics for the mod. */
  stats: ModStats | undefined;
  capabilities?: EditorCapabilities;
}

const activeRowDetail = (activeRow: StringRow, caps: EditorCapabilities): string => {
  if (caps.isDisco) {
    const key = formatDiscoPoKey(activeRow.path) || '—';
    const audio = activeRow.edid?.trim() ? activeRow.edid : '—';
    return `${activeRow.signature} · ${key} · ${audio}`;
  }
  if (activeRow.signature === 'PEX') {
    return `${activeRow.signature} · ${resolvePexScriptContext(activeRow) ?? activeRow.path?.split('\\').pop() ?? '—'}`;
  }
  return `${activeRow.signature} · ${activeRow.formid_hex} · ${activeRow.edid ?? '—'}`;
};

/**
 * Thin status bar rendered at the very bottom of the editor page.
 * Shows selection count, active-row metadata, and per-status totals.
 */
export const EditorStatusBar = ({
  selectedCount,
  activeRow,
  stats,
  capabilities: capabilitiesProp,
}: EditorStatusBarProps) => {
  const { t } = useTranslation();
  const capabilities = capabilitiesProp ?? editorCapabilities('fo4');

  return (
    <div className={styles.statusBar}>
      <span>{t('modEditor.selectedRows', { count: selectedCount })}</span>
      {activeRow && (
        <span className={styles.detail}>{activeRowDetail(activeRow, capabilities)}</span>
      )}
      {stats && (
        <span className={styles.stats}>
          {t('status.approved')}: {stats.approved} · {t('status.draft')}: {stats.draft} ·{' '}
          {t('status.rejected')}: {stats.rejected} · {t('status.tm')}: {stats.tm} ·{' '}
          {t('status.fuzzy')}: {stats.fuzzy} · {t('status.auto')}: {stats.auto_translated} ·{' '}
          {t('status.skip')}: {stats.skipped ?? 0} · {t('status.untranslated')}:{' '}
          {stats.untranslated} · {t('status.total')}: {stats.total}
        </span>
      )}
    </div>
  );
};
