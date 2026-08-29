import { useTranslation } from 'react-i18next';
import rowS from './UnifiedJobRow/UnifiedJobRow.module.scss';

export interface ModDataMenuItemsProps {
  clearingRows?: boolean;
  deletingAll?: boolean;
  exportingLangpack?: boolean;
  /** When true, only batch-capable actions are shown (export + delete). */
  batchOnly?: boolean;
  onClearRows: () => void;
  onDeleteAll: () => void;
  onExportLangpack?: () => void;
  onAfterAction?: () => void;
}

/** Shared overflow-menu entries for mod row data management (clear rows / delete all). */
export const ModDataMenuItems = ({
  clearingRows,
  deletingAll,
  exportingLangpack,
  batchOnly,
  onClearRows,
  onDeleteAll,
  onExportLangpack,
  onAfterAction,
}: ModDataMenuItemsProps) => {
  const { t } = useTranslation();
  const busy = clearingRows || deletingAll || exportingLangpack;

  return (
    <>
      {batchOnly && onExportLangpack && (
        <button
          type="button"
          onClick={() => {
            onExportLangpack();
            onAfterAction?.();
          }}
          className={rowS.menuItem}
          disabled={busy}
        >
          <span className={rowS.menuIcon}>📄</span>
          <span>{exportingLangpack ? t('mods.exportingLangpack') : t('mods.exportLangpack')}</span>
        </button>
      )}
      {!batchOnly && (
        <button
          type="button"
          onClick={() => {
            onClearRows();
            onAfterAction?.();
          }}
          className={rowS.menuItem}
          disabled={busy}
        >
          <span className={rowS.menuIcon}>⌫</span>
          <span>{clearingRows ? t('mods.clearingRows') : t('mods.clearRows')}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          onDeleteAll();
          onAfterAction?.();
        }}
        className={`${rowS.menuItem} ${rowS.menuItemDanger}`}
        disabled={busy}
      >
        <span className={rowS.menuIcon}>🗑</span>
        <span>{deletingAll ? t('mods.deletingAll') : t('mods.deleteAll')}</span>
      </button>
    </>
  );
};
