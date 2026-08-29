import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ModImportDeleteDataMode, type ModImportJob } from '../../../api';
import { useToast } from '../../../components/Toast';

type UseModDeleteActionsOptions = {
  refreshAll: () => void;
  clearModSelection: () => void;
};

export const useModDeleteActions = ({
  refreshAll,
  clearModSelection,
}: UseModDeleteActionsOptions) => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [deleteModalJob, setDeleteModalJob] = useState<ModImportJob | null>(null);
  const [deletingModJobId, setDeletingModJobId] = useState<number | null>(null);
  const [deleteSimpleJob, setDeleteSimpleJob] = useState<{
    kind: 'eet' | 'csv';
    name: string;
    id: number;
  } | null>(null);
  const [pendingClear, setPendingClear] = useState<{ id: number; name: string } | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState<{
    mods: Array<{ id: number; name: string }>;
  } | null>(null);
  const [clearingModId, setClearingModId] = useState<number | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const requestDeleteMods = useCallback((modsToDelete: Array<{ id: number; name: string }>) => {
    if (modsToDelete.length === 0) return;
    setPendingDeleteAll({ mods: modsToDelete });
  }, []);

  const confirmClearRows = async () => {
    if (!pendingClear) return;
    setClearingModId(pendingClear.id);
    try {
      const result = await api.mods.clearRows(pendingClear.id);
      await refreshAll();
      showToast(t('mods.clearRowsSuccess', { count: result.deletedRecords }), 'success');
      setPendingClear(null);
    } catch (err) {
      showToast(t('common.error', { message: String(err) }), 'error');
    } finally {
      setClearingModId(null);
    }
  };

  const confirmDeleteAll = async () => {
    if (!pendingDeleteAll) return;
    const { mods: modsToDelete } = pendingDeleteAll;
    setDeletingAll(true);
    try {
      const result = await api.mods.removeBatch(modsToDelete.map((mod) => mod.id));
      if (result.deletedMods === 0) {
        throw new Error('No mods were deleted');
      }
      refreshAll();
      if (modsToDelete.length === 1) {
        showToast(t('mods.deleteAllSuccess', { name: modsToDelete[0].name }), 'success');
      } else {
        showToast(t('mods.deleteAllBatchSuccess', { count: result.deletedMods }), 'success');
      }
      setPendingDeleteAll(null);
      clearModSelection();
    } catch (err) {
      showToast(t('common.error', { message: String(err) }), 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  const confirmDeleteMod = useCallback(
    async (deleteData: ModImportDeleteDataMode) => {
      if (!deleteModalJob) return;
      setDeletingModJobId(deleteModalJob.id);
      try {
        await api.modImport.remove(deleteModalJob.id, deleteData);
        setDeleteModalJob(null);
        refreshAll();
      } catch (err) {
        window.alert(String(err));
      } finally {
        setDeletingModJobId(null);
      }
    },
    [deleteModalJob, refreshAll],
  );

  return {
    deleteModalJob,
    setDeleteModalJob,
    deletingModJobId,
    deleteSimpleJob,
    setDeleteSimpleJob,
    pendingClear,
    setPendingClear,
    pendingDeleteAll,
    setPendingDeleteAll,
    clearingModId,
    deletingAll,
    requestDeleteMods,
    confirmClearRows,
    confirmDeleteAll,
    confirmDeleteMod,
  };
};
