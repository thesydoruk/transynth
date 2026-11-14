import { useTranslation } from 'react-i18next';
import { ReimportModal } from '../../components/ReimportModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useModsWorkspace } from './ModsWorkspaceContext';
import { DeleteModConfirmModal } from './DeleteModConfirmModal/DeleteModConfirmModal';

/** Re-import and delete confirmations; their state lives in the workspace context. */
export const ModsPageModals = () => {
  const { t } = useTranslation();
  const { reimport, closeReimport, deleteActions } = useModsWorkspace();
  const {
    deleteModalJob,
    deletingModJobId,
    pendingClear,
    clearingModId,
    pendingDeleteAll,
    deletingAll,
    keepReference,
  } = deleteActions;

  return (
    <>
      {reimport && (
        <ReimportModal
          newModId={reimport.newModId}
          prevVersions={reimport.prevVersions}
          onClose={closeReimport}
        />
      )}

      {deleteModalJob && (
        <DeleteModConfirmModal
          fileName={deleteModalJob.file_name}
          deleting={deletingModJobId === deleteModalJob.id}
          onClose={() => deleteActions.setDeleteModalJob(null)}
          onConfirm={(deleteData, keep) => {
            void deleteActions.confirmDeleteMod(deleteData, keep);
          }}
        />
      )}

      {pendingClear && (
        <ConfirmModal
          title={t('mods.clearRowsTitle')}
          message={t('mods.clearRowsMessage', { name: pendingClear.name })}
          confirmLabel={t('mods.clearRows')}
          pending={clearingModId === pendingClear.id}
          onClose={() => deleteActions.setPendingClear(null)}
          onConfirm={() => {
            void deleteActions.confirmClearRows();
          }}
        />
      )}

      {pendingDeleteAll && (
        <ConfirmModal
          title={
            pendingDeleteAll.mods.length === 1
              ? t('mods.deleteAllTitle')
              : t('mods.deleteAllBatchTitle')
          }
          message={
            pendingDeleteAll.mods.length === 1
              ? t('mods.deleteAllMessage', { name: pendingDeleteAll.mods[0].name })
              : t('mods.deleteAllBatchMessage', { count: pendingDeleteAll.mods.length })
          }
          confirmLabel={t('mods.deleteAll')}
          pending={deletingAll}
          onClose={() => deleteActions.setPendingDeleteAll(null)}
          onConfirm={() => {
            void deleteActions.confirmDeleteAll();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={keepReference}
              disabled={deletingAll}
              onChange={(e) => deleteActions.setKeepReference(e.target.checked)}
            />
            <span>{t('mods.deleteAllKeepReference')}</span>
          </label>
        </ConfirmModal>
      )}
    </>
  );
};
