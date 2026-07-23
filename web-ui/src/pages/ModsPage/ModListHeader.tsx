import { useTranslation } from 'react-i18next';
import { ModDataMenuItems } from './ModDataMenuItems';
import rowS from './UnifiedJobRow/UnifiedJobRow.module.scss';
import s from './ModsPage.module.scss';

type ModListHeaderProps = {
  selectAllRef: React.RefObject<HTMLInputElement | null>;
  allModsSelected: boolean;
  selectedModCount: number;
  multiSelectActive: boolean;
  deletingAll: boolean;
  batchMenuOpen: boolean;
  batchMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onToggleBatchMenu: (e: React.MouseEvent) => void;
  onBatchDeleteAll: () => void;
  onCloseBatchMenu: () => void;
};

export const ModListHeader = ({
  selectAllRef,
  allModsSelected,
  selectedModCount,
  multiSelectActive,
  deletingAll,
  batchMenuOpen,
  batchMenuRef,
  onToggleSelectAll,
  onClearSelection,
  onToggleBatchMenu,
  onBatchDeleteAll,
  onCloseBatchMenu,
}: ModListHeaderProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.modListHeader}>
      <label className={s.selectAllLabel}>
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allModsSelected}
          onChange={onToggleSelectAll}
          disabled={deletingAll}
        />
        {selectedModCount > 0
          ? t('mods.selectedCount', { count: selectedModCount })
          : t('mods.selectAll')}
      </label>
      {selectedModCount > 0 && (
        <>
          <button
            type="button"
            className={s.selectionBtn}
            onClick={onClearSelection}
            disabled={deletingAll}
          >
            {t('mods.clearSelection')}
          </button>
          {multiSelectActive && (
            <div className={rowS.menuWrap} ref={batchMenuRef}>
              <button
                type="button"
                className={s.selectionBtn}
                disabled={deletingAll}
                onClick={onToggleBatchMenu}
              >
                {t('mods.batchActions')} ⋯
              </button>
              {batchMenuOpen && (
                <div className={rowS.menuList}>
                  <ModDataMenuItems
                    deletingAll={deletingAll}
                    batchOnly
                    onClearRows={() => {}}
                    onDeleteAll={() => {
                      onBatchDeleteAll();
                      onCloseBatchMenu();
                    }}
                    onAfterAction={onCloseBatchMenu}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
