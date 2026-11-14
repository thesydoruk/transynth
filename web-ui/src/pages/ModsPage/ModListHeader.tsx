import { useTranslation } from 'react-i18next';
import { ModDataMenuItems } from './ModDataMenuItems';
import { useModsWorkspace } from './ModsWorkspaceContext';
import rowS from './UnifiedJobRow/UnifiedJobRow.module.scss';
import s from './ModsPage.module.scss';

/** Select all / batch actions for the mods currently visible on the page. */
export const ModListHeader = () => {
  const { t } = useTranslation();
  const { selection, deleteActions, exportSelected, exportingLangpack } = useModsWorkspace();
  const { deletingAll } = deleteActions;
  const busy = deletingAll || exportingLangpack;

  return (
    <div className={s.modListHeader}>
      <label className={s.selectAllLabel}>
        <input
          ref={selection.selectAllRef}
          type="checkbox"
          checked={selection.allModsSelected}
          onChange={selection.toggleSelectAllMods}
          disabled={busy}
        />
        {selection.selectedModCount > 0
          ? t('mods.selectedCount', { count: selection.selectedModCount })
          : t('mods.selectAll')}
      </label>
      {selection.selectedModCount > 0 && (
        <>
          <button
            type="button"
            className={s.selectionBtn}
            onClick={selection.clearModSelection}
            disabled={busy}
          >
            {t('mods.clearSelection')}
          </button>
          {selection.multiSelectActive && (
            <div className={rowS.menuWrap} ref={selection.batchMenuRef}>
              <button
                type="button"
                className={s.selectionBtn}
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  selection.setBatchMenuOpen((open) => !open);
                }}
              >
                {t('mods.batchActions')} ⋯
              </button>
              {selection.batchMenuOpen && (
                <div className={rowS.menuList}>
                  <ModDataMenuItems
                    deletingAll={deletingAll}
                    exportingLangpack={exportingLangpack}
                    batchOnly
                    onClearRows={() => {}}
                    onDeleteAll={() => {
                      deleteActions.requestDeleteMods(selection.selectedModsForDelete());
                      selection.setBatchMenuOpen(false);
                    }}
                    onExportLangpack={exportSelected}
                    onAfterAction={() => selection.setBatchMenuOpen(false)}
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
