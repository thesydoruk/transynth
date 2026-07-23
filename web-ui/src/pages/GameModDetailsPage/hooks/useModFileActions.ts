import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type NexusModFile } from '../../../api';
import {
  patchNexusDownloadJob,
  removeNexusDownloadJob,
  type NexusDownloadJob,
  upsertNexusDownloadJob,
} from '../../../nexusDownloadQueue';

export const useModFileActions = (
  gameId: string,
  numericModId: number,
  nexusDownloads: NexusDownloadJob[],
) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [fileActionInfo, setFileActionInfo] = useState<string | null>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  const downloadJobMap = useMemo(() => {
    const map = new Map<number, NexusDownloadJob>();
    for (const job of nexusDownloads) {
      if (job.gameId === gameId && job.modId === numericModId) {
        map.set(job.fileId, job);
      }
    }
    return map;
  }, [nexusDownloads, gameId, numericModId]);

  const handleFileDownload = async (file: NexusModFile) => {
    setFileActionError(null);
    setFileActionInfo(null);
    setBusyActionKey(`download:${file.fileId}`);

    try {
      await api.games.downloadModFile(
        gameId,
        numericModId,
        file.fileId,
        file.fileName ?? file.name,
      );
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleFileImport = async (file: NexusModFile) => {
    setFileActionError(null);
    setFileActionInfo(null);
    setBusyActionKey(`import:${file.fileId}`);

    const queueId = `nexus:${gameId}:${numericModId}:${file.fileId}`;
    upsertNexusDownloadJob({
      id: queueId,
      gameId,
      modId: numericModId,
      fileId: file.fileId,
      fileName: file.fileName ?? file.name,
      status: 'downloading',
      progress: 0,
      createdAt: Date.now(),
    });

    let pseudoProgress = 0;
    const progressTick = setInterval(() => {
      pseudoProgress = Math.min(93, pseudoProgress + (Math.random() * 7 + 2));
      patchNexusDownloadJob(queueId, { progress: Math.round(pseudoProgress) });
    }, 700);

    try {
      const job = await api.games.importModFile(gameId, numericModId, file.fileId);

      if (job.running) {
        setFileActionInfo(t('games.fileImportAlreadyRunning'));
        clearInterval(progressTick);
        removeNexusDownloadJob(queueId);
        setBusyActionKey(null);
        return;
      }

      if (job.status === 'completed') {
        setFileActionInfo(t('games.fileImportAlreadyCompleted'));
        clearInterval(progressTick);
        removeNexusDownloadJob(queueId);
        setBusyActionKey(null);
        return;
      }

      setFileActionInfo(t('games.fileImportQueued', { name: file.name }));
      qc.invalidateQueries({ queryKey: ['mod-imports'] });

      clearInterval(progressTick);
      patchNexusDownloadJob(queueId, { progress: 100 });
      setTimeout(() => removeNexusDownloadJob(queueId), 700);
      setBusyActionKey(null);
      return;
    } catch (error) {
      clearInterval(progressTick);
      patchNexusDownloadJob(queueId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      setFileActionError(error instanceof Error ? error.message : String(error));
    }

    setBusyActionKey(null);
  };

  return {
    fileActionError,
    fileActionInfo,
    busyActionKey,
    downloadJobMap,
    handleFileDownload,
    handleFileImport,
  };
};
