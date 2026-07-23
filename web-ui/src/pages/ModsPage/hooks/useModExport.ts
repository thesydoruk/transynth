import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { upsertAppJob } from '../../../appJobsQueue';
import { api } from '../../../api';

export const useModExport = () => {
  const { t } = useTranslation();
  const [exportBusy, setExportBusy] = useState<string | null>(null);

  const runModExport = useCallback(
    async (
      modId: number,
      exportSrcLang: string,
      exportTgtLang: string,
      labelName: string,
      type: 'langpack' | 'fullMod',
      busyKey: string,
    ) => {
      const appJobId = `export-${modId}-${type}-${Date.now()}`;
      const now = Date.now();
      const label =
        type === 'langpack'
          ? `${labelName} · ${t('mods.exportLangpack')}`
          : `${labelName} · ${t('mods.exportFullMod')}`;
      upsertAppJob({
        id: appJobId,
        kind: 'export',
        label,
        status: 'running',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      });
      setExportBusy(busyKey);
      try {
        if (type === 'langpack') {
          await api.mods.exportLangpack(modId, exportSrcLang, exportTgtLang);
        } else {
          await api.mods.exportFullMod(modId, exportSrcLang, exportTgtLang);
        }
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
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'langpack',
              `${busyPrefix}:langpack`,
            );
          },
          disabled: isBusy,
        },
        {
          key: 'fullMod' as const,
          icon: '📦',
          title: t('mods.exportFullMod'),
          onClick: () => {
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'fullMod',
              `${busyPrefix}:fullMod`,
            );
          },
          disabled: isBusy,
        },
      ];
    },
    [exportBusy, runModExport, t],
  );

  return { buildExportActions };
};
