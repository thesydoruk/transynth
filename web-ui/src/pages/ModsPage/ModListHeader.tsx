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
  onBatchExportLangpack: () => void;
  onCloseBatchMenu: () => void;
  exportingLangpack: boolean;
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
  onBatchExportLangpack,
  onCloseBatchMenu,
  exportingLangpack,
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
          disabled={deletingAll || exportingLangpack}
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
            disabled={deletingAll || exportingLangpack}
          >
            {t('mods.clearSelection')}
          </button>
          {multiSelectActive && (
            <div className={rowS.menuWrap} ref={batchMenuRef}>
              <button
                type="button"
                className={s.selectionBtn}
                disabled={deletingAll || exportingLangpack}
                onClick={onToggleBatchMenu}
              >
                {t('mods.batchActions')} ⋯
              </button>
              {batchMenuOpen && (
                <div className={rowS.menuList}>
                  <ModDataMenuItems
                    deletingAll={deletingAll}
                    exportingLangpack={exportingLangpack}
                    batchOnly
                    onClearRows={() => {}}
                    onDeleteAll={() => {
                      onBatchDeleteAll();
                      onCloseBatchMenu();
                    }}
                    onExportLangpack={onBatchExportLangpack}
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
