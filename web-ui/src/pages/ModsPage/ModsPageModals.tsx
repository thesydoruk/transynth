import { useTranslation } from 'react-i18next';
import {
  api,
  type CsvImportJob,
  type EetImportJob,
  type ModImportDeleteDataMode,
  type ModImportJob,
  type PreviousVersionRow,
} from '../../api';
import { ReimportModal } from '../../components/ReimportModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { CsvPreviewModal } from './CsvPreviewModal';
import { DeleteModConfirmModal } from './DeleteModConfirmModal/DeleteModConfirmModal';
import { EetPreviewModal } from './EetPreviewModal';

type ModsPageModalsProps = {
  eetPreviewJob: EetImportJob | null | undefined;
  csvPreviewJob: CsvImportJob | null | undefined;
  reimport: { newModId: number; prevVersions: PreviousVersionRow[] } | null;
  deleteModalJob: ModImportJob | null;
  deletingModJobId: number | null;
  deleteSimpleJob: { kind: 'eet' | 'csv'; name: string; id: number } | null;
  pendingClear: { id: number; name: string } | null;
  clearingModId: number | null;
  pendingDeleteAll: { mods: Array<{ id: number; name: string }> } | null;
  deletingAll: boolean;
  refreshAll: () => void;
  doStart: (kind: 'eet' | 'csv' | 'mod', jobId: number) => Promise<boolean>;
  onCloseEetPreview: () => void;
  onCloseCsvPreview: () => void;
  onCloseReimport: () => void;
  onCloseDeleteModal: () => void;
  onConfirmDeleteMod: (deleteData: ModImportDeleteDataMode) => void;
  onCloseDeleteSimple: () => void;
  onClosePendingClear: () => void;
  onConfirmClearRows: () => void;
  onClosePendingDeleteAll: () => void;
  onConfirmDeleteAll: () => void;
};

export const ModsPageModals = ({
  eetPreviewJob,
  csvPreviewJob,
  reimport,
  deleteModalJob,
  deletingModJobId,
  deleteSimpleJob,
  pendingClear,
  clearingModId,
  pendingDeleteAll,
  deletingAll,
  refreshAll,
  doStart,
  onCloseEetPreview,
  onCloseCsvPreview,
  onCloseReimport,
  onCloseDeleteModal,
  onConfirmDeleteMod,
  onCloseDeleteSimple,
  onClosePendingClear,
  onConfirmClearRows,
  onClosePendingDeleteAll,
  onConfirmDeleteAll,
}: ModsPageModalsProps) => {
  const { t } = useTranslation();

  return (
    <>
      {eetPreviewJob && (
        <EetPreviewModal
          job={eetPreviewJob}
          onClose={onCloseEetPreview}
          onConfirm={async (previewSrcLang, previewTgtLang) => {
            await api.eet.updateLanguages(eetPreviewJob.id, previewSrcLang, previewTgtLang);
            refreshAll();
            onCloseEetPreview();
            setTimeout(() => doStart('eet', eetPreviewJob.id), 100);
          }}
        />
      )}
      {csvPreviewJob && (
        <CsvPreviewModal
          job={csvPreviewJob}
          onClose={onCloseCsvPreview}
          onConfirm={async (previewSrcLang, previewTgtLang) => {
            await api.csv.updateLanguages(csvPreviewJob.id, previewSrcLang, previewTgtLang);
            refreshAll();
            onCloseCsvPreview();
            setTimeout(() => doStart('csv', csvPreviewJob.id), 100);
          }}
        />
      )}

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
          onConfirm={(deleteData) => {
            void onConfirmDeleteMod(deleteData);
          }}
        />
      )}

      {deleteSimpleJob && (
        <ConfirmModal
          title={t('imports.deleteJobTitle')}
          message={t('imports.deleteJobMessage', { name: deleteSimpleJob.name })}
          confirmLabel={t('common.delete')}
          onClose={onCloseDeleteSimple}
          onConfirm={() => {
            const { kind, id } = deleteSimpleJob;
            const p = kind === 'eet' ? api.eet.remove(id) : api.csv.remove(id);
            p.then(refreshAll);
            onCloseDeleteSimple();
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
        />
      )}
    </>
  );
};
