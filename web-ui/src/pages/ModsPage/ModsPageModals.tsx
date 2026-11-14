import { useTranslation } from 'react-i18next';
import {
  type ModImportDeleteDataMode,
  type ModImportJob,
  type PreviousVersionRow,
} from '../../api';
import { ReimportModal } from '../../components/ReimportModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { DeleteModConfirmModal } from './DeleteModConfirmModal/DeleteModConfirmModal';

type ModsPageModalsProps = {
  reimport: { newModId: number; prevVersions: PreviousVersionRow[] } | null;
  deleteModalJob: ModImportJob | null;
  deletingModJobId: number | null;
  pendingClear: { id: number; name: string } | null;
  clearingModId: number | null;
  pendingDeleteAll: { mods: Array<{ id: number; name: string }> } | null;
  deletingAll: boolean;
  keepReference: boolean;
  onKeepReferenceChange: (value: boolean) => void;
  onCloseReimport: () => void;
  onCloseDeleteModal: () => void;
  onConfirmDeleteMod: (deleteData: ModImportDeleteDataMode, keepReference: boolean) => void;
  onClosePendingClear: () => void;
  onConfirmClearRows: () => void;
  onClosePendingDeleteAll: () => void;
  onConfirmDeleteAll: () => void;
};

export const ModsPageModals = ({
  reimport,
  deleteModalJob,
  deletingModJobId,
  pendingClear,
  clearingModId,
  pendingDeleteAll,
  deletingAll,
  keepReference,
  onKeepReferenceChange,
  onCloseReimport,
  onCloseDeleteModal,
  onConfirmDeleteMod,
  onClosePendingClear,
  onConfirmClearRows,
  onClosePendingDeleteAll,
  onConfirmDeleteAll,
}: ModsPageModalsProps) => {
  const { t } = useTranslation();

  return (
    <>
      {reimport && (
        <ReimportModal
          newModId={reimport.newModId}
          prevVersions={reimport.prevVersions}
          onClose={onCloseReimport}
        />
      )}

      {deleteModalJob && (
        <DeleteModConfirmModal
          fileName={deleteModalJob.file_name}
          deleting={deletingModJobId === deleteModalJob.id}
          onClose={onCloseDeleteModal}
          onConfirm={(deleteData, keep) => {
            void onConfirmDeleteMod(deleteData, keep);
          }}
        />
      )}

      {pendingClear && (
        <ConfirmModal
          title={t('mods.clearRowsTitle')}
          message={t('mods.clearRowsMessage', { name: pendingClear.name })}
          confirmLabel={t('mods.clearRows')}
          pending={clearingModId === pendingClear.id}
          onClose={onClosePendingClear}
          onConfirm={() => {
            void onConfirmClearRows();
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
          onClose={onClosePendingDeleteAll}
          onConfirm={() => {
            void onConfirmDeleteAll();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={keepReference}
              disabled={deletingAll}
              onChange={(e) => onKeepReferenceChange(e.target.checked)}
            />
            <span>{t('mods.deleteAllKeepReference')}</span>
          </label>
        </ConfirmModal>
      )}
    </>
  );
};
