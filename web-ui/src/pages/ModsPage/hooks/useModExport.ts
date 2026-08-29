import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { upsertAppJob } from '../../../appJobsQueue';
import { api } from '../../../api';
import { useToast } from '../../../components/Toast';

export const useModExport = (onLangpackStarted?: () => void) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [exportBusy, setExportBusy] = useState<string | null>(null);

  const startLangpackJob = useCallback(
    async (modIds: number[], exportSrcLang: string, exportTgtLang: string, busyKey: string) => {
      if (modIds.length === 0) return;
      setExportBusy(busyKey);
      try {
        await api.exports.startLangpack(modIds, exportSrcLang, exportTgtLang);
        showToast(t('mods.exportStarted'), 'success');
        onLangpackStarted?.();
      } catch (err) {
        showToast(t('common.error', { message: String(err) }), 'error');
      } finally {
        setExportBusy(null);
      }
    },
    [onLangpackStarted, showToast, t],
  );

  const runFullModExport = useCallback(
    async (modId: number, exportSrcLang: string, exportTgtLang: string, labelName: string) => {
      const appJobId = `export-${modId}-fullMod-${Date.now()}`;
      const now = Date.now();
      const label = `${labelName} · ${t('mods.exportFullMod')}`;
      upsertAppJob({
        id: appJobId,
        kind: 'export',
        label,
        status: 'running',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      });
      setExportBusy(`mod-${modId}:fullMod`);
      try {
        await api.mods.exportFullMod(modId, exportSrcLang, exportTgtLang);
        upsertAppJob({
          id: appJobId,
          kind: 'export',
          label,
          status: 'completed',
          progress: 100,
          createdAt: now,
          updatedAt: Date.now(),
        });
      } catch (err) {
        upsertAppJob({
          id: appJobId,
          kind: 'export',
          label,
          status: 'failed',
          progress: null,
          error: String(err),
          createdAt: now,
          updatedAt: Date.now(),
        });
        window.alert(String(err));
      } finally {
        setExportBusy(null);
      }
    },
    [t],
  );

  const buildExportActions = useCallback(
    (
      modId: number,
      labelName: string,
      exportSrcLang: string,
      exportTgtLang: string,
      busyPrefix: string,
    ) => {
      const isBusy = exportBusy != null && exportBusy.startsWith(`${busyPrefix}:`);
      return [
        {
          key: 'langpack' as const,
          icon: '📄',
          title: t('mods.exportLangpack'),
          onClick: () => {
            void startLangpackJob([modId], exportSrcLang, exportTgtLang, `${busyPrefix}:langpack`);
          },
          disabled: isBusy,
        },
        {
          key: 'fullMod' as const,
          icon: '📦',
          title: t('mods.exportFullMod'),
          onClick: () => {
            void runFullModExport(modId, exportSrcLang, exportTgtLang, labelName);
          },
          disabled: isBusy,
        },
      ];
    },
    [exportBusy, runFullModExport, startLangpackJob, t],
  );

  const runBatchLangpackExport = useCallback(
    async (modIds: number[], exportSrcLang: string, exportTgtLang: string) => {
      await startLangpackJob(modIds, exportSrcLang, exportTgtLang, 'batch:langpack');
    },
    [startLangpackJob],
  );

  return {
    buildExportActions,
    runBatchLangpackExport,
    exportingBatchLangpack: exportBusy === 'batch:langpack',
  };
};
