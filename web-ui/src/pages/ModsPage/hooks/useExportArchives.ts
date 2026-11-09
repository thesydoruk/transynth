import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { ExportArchive } from '../../../api';

const POLL_MS = 2500;

export const useExportArchives = (gameId: string) => {
  const [archives, setArchives] = useState<ExportArchive[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const { archives: next } = await api.exports.list(gameId);
    setArchives(next);
  }, [gameId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const hasRunning = archives.some((archive) => archive.status === 'running');
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [archives, refresh]);

  const remove = useCallback(
    async (archive: ExportArchive) => {
      setDeletingId(archive.id);
      try {
        await api.exports.remove(archive.id);
        await refresh();
      } finally {
        setDeletingId(null);
      }
    },
    [refresh],
  );

  return { archives, deletingId, refresh, remove };
};
