import { useTranslation } from 'react-i18next';
import rowS from './UnifiedJobRow/UnifiedJobRow.module.scss';

export interface ModDataMenuItemsProps {
  clearingRows?: boolean;
  deletingAll?: boolean;
  /** When true, only batch-capable actions are shown (currently delete all). */
  batchOnly?: boolean;
  onClearRows: () => void;
  onDeleteAll: () => void;
  onAfterAction?: () => void;
}

/** Shared overflow-menu entries for mod row data management (clear rows / delete all). */
export const ModDataMenuItems = ({
  clearingRows,
  deletingAll,
  batchOnly,
  onClearRows,
  onDeleteAll,
  onAfterAction,
}: ModDataMenuItemsProps) => {
  const { t } = useTranslation();
  const busy = clearingRows || deletingAll;

  return (
    <>
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
