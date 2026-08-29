import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type UploadProgressEvent, type ModImportJob } from '../../../api';
import { isSupportedGameId, kindFromExt } from '../modsPageUtils';
import type { PendingModUpload } from '../modsPageTypes';

type UseModUploadOptions = {
  gameId: string;
  doStart: (kind: 'eet' | 'csv' | 'mod', jobId: number) => Promise<boolean>;
  startModImportJob: (job: ModImportJob) => Promise<void>;
  refreshAll: () => void;
};

export const useModUpload = ({
  gameId,
  doStart,
  startModImportJob,
  refreshAll,
}: UseModUploadOptions) => {
  const [uploading, setUploading] = useState(false);
  const [pendingModUploads, setPendingModUploads] = useState<PendingModUpload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const advancedFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const hasExtracting = pendingModUploads.some(
      (row) => row.phase === 'extracting' && row.percent < 95,
    );
    if (!hasExtracting) return;

    const timer = window.setInterval(() => {
      setPendingModUploads((prev) =>
        prev.map((row) => {
          if (row.phase !== 'extracting') return row;
          if (row.percent >= 95) return row;
          return { ...row, percent: Math.min(95, row.percent + 2) };
        }),
      );
    }, 250);

    return () => window.clearInterval(timer);
  }, [pendingModUploads]);

  const processFiles = async (input: HTMLInputElement | null) => {
    const files = input?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const kind = kindFromExt(f.name);
        if (!kind) continue;
        if (kind === 'eet') {
          const job = await api.eet.upload(f);
          if (job) doStart('eet', job.id);
        } else if (kind === 'csv') {
          const job = await api.csv.upload(f);
          if (job) doStart('csv', job.id);
        } else {
          const uploadOptions = isSupportedGameId(gameId) ? { game: gameId } : undefined;
          const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          setPendingModUploads((prev) => [
            ...prev,
            { id: uploadId, fileName: f.name, phase: 'uploading', percent: 0 },
          ]);

          const onUploadProgress = (event: UploadProgressEvent) => {
            setPendingModUploads((prev) =>
              prev.map((row) =>
                row.id === uploadId && row.phase === 'uploading'
                  ? { ...row, percent: event.percent }
                  : row,
              ),
            );
          };

          const onExtractingStart = () => {
            setPendingModUploads((prev) =>
              prev.map((row) =>
                row.id === uploadId ? { ...row, phase: 'extracting', percent: 5 } : row,
              ),
            );
          };

          const job = await api.modImport.upload(
            f,
            uploadOptions,
            onUploadProgress,
            onExtractingStart,
          );
          setPendingModUploads((prev) =>
            prev.map((row) =>
              row.id === uploadId ? { ...row, phase: 'extracting', percent: 100 } : row,
            ),
          );
          if (job) {
            refreshAll();
            void startModImportJob(job);
          }
          setPendingModUploads((prev) => prev.filter((row) => row.id !== uploadId));
        }
      }
      refreshAll();
    } finally {
      setUploading(false);
      if (input) input.value = '';
    }
  };

  const handleUpload = () => processFiles(fileRef.current);
  const handleAdvancedUpload = () => processFiles(advancedFileRef.current);

  const openFilePicker = useCallback(() => {
    fileRef.current?.click();
  }, []);

  return {
    uploading,
    pendingModUploads,
    fileRef,
    advancedFileRef,
    handleUpload,
    handleAdvancedUpload,
    openFilePicker,
  };
};
