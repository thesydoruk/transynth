import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  EetGameMismatchError,
  type UploadProgressEvent,
  type ModImportJob,
} from '../../../api';
import { useToast } from '../../../components/Toast';
import { kindFromExt } from '../modsPageUtils';
import type { PendingModUpload } from '../modsPageTypes';

type UseModUploadOptions = {
  /** Every upload — mod, EET or CSV — is filed under this game and language pair. */
  gameId: string;
  srcLang: string;
  tgtLang: string;
  doStart: (kind: 'eet' | 'csv' | 'mod', jobId: number) => Promise<boolean>;
  startModImportJob: (job: ModImportJob) => Promise<void>;
  refreshAll: () => void;
};

export const useModUpload = ({
  gameId,
  srcLang,
  tgtLang,
  doStart,
  startModImportJob,
  refreshAll,
}: UseModUploadOptions) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
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

  const uploadModFile = async (
    f: File,
    uploadOptions: { game?: string; srcLang: string; tgtLang: string },
  ) => {
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

    try {
      const job = await api.modImport.upload(f, uploadOptions, onUploadProgress, onExtractingStart);
      setPendingModUploads((prev) =>
        prev.map((row) =>
          row.id === uploadId ? { ...row, phase: 'extracting', percent: 100 } : row,
        ),
      );
      if (job) {
        refreshAll();
        void startModImportJob(job);
      }
    } finally {
      setPendingModUploads((prev) => prev.filter((row) => row.id !== uploadId));
    }
  };

  const processFiles = async (input: HTMLInputElement | null) => {
    const files = input?.files;
    if (!files?.length) return;
    setUploading(true);
    // The server validates the game id against its registered games.
    const uploadOptions = { game: gameId || undefined, srcLang, tgtLang };
    try {
      for (const f of Array.from(files)) {
        const kind = kindFromExt(f.name);
        if (!kind) continue;
        try {
          if (kind === 'eet') {
            const job = await api.eet.upload(f, uploadOptions);
            if (job) doStart('eet', job.id);
          } else if (kind === 'csv') {
            const job = await api.csv.upload(f, uploadOptions);
            if (job) doStart('csv', job.id);
          } else {
            await uploadModFile(f, uploadOptions);
          }
        } catch (err) {
          // One refused file must not stop the rest of the selection.
          showToast(
            err instanceof EetGameMismatchError
              ? t('imports.eetGameMismatch', { file: f.name, fileGame: err.fileGame })
              : t('imports.uploadFailed', {
                  file: f.name,
                  message: err instanceof Error ? err.message : String(err),
                }),
            'error',
          );
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
