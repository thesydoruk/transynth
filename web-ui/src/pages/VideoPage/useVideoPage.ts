import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import type { VideoAsset } from '../../api';

const BUSY = new Set(['separating', 'dubbing']);

/** Statuses from which a (re)separation may start. */
const SEPARATABLE = new Set(['uploaded', 'separated', 'dubbed', 'packed', 'error']);

/** The cutscene videos of a game; polls faster while a job runs on one of them. */
export const useVideoPage = (gameId: string) => {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['video-assets', gameId],
    queryFn: () => api.video.list(gameId),
    enabled: !!gameId,
    refetchInterval: (query) =>
      query.state.data?.assets.some((a) => BUSY.has(a.status)) ? 5000 : 30000,
  });
  const assets = list.data?.assets ?? [];
  const services = list.data?.services ?? {};
  const selected = assets.find((a) => a.id === selectedId) ?? null;

  const segments = useQuery({
    queryKey: ['video-segments', gameId, selectedId],
    queryFn: () => api.video.segments(gameId, selectedId!),
    enabled: selectedId != null,
    refetchInterval: selected && BUSY.has(selected.status) ? 5000 : false,
  });

  const separate = useMutation({
    mutationFn: (id: number) => api.video.separate(gameId, id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['video-assets', gameId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const canSeparate = (asset: VideoAsset): { ok: boolean; missing: string | null } => {
    if (!asset.audio_rel_path || !SEPARATABLE.has(asset.status) || separate.isPending) {
      return { ok: false, missing: null };
    }
    const missing = (['separate', 'asr'] as const).find((kind) => services[kind] === false);
    return { ok: !missing, missing: missing ?? null };
  };

  return {
    assets,
    services,
    isLoading: list.isLoading,
    error: error ?? (list.error instanceof Error ? list.error.message : null),
    clearError: () => setError(null),
    selected,
    select: (id: number | null) => setSelectedId(id),
    segments: segments.data?.segments ?? [],
    segmentsLoading: segments.isLoading,
    separate: (id: number) => separate.mutate(id),
    canSeparate,
  };
};

export const formatDuration = (seconds: number | null): string => {
  if (seconds == null) return '—';
  const whole = Math.round(seconds);
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
};

export const formatMiB = (bytes: number): string => `${Math.round(bytes / 1048576)} MiB`;

/** Which audio the row can play: the dub once it exists, else the uploaded source. */
export const playableKind = (asset: VideoAsset): 'dub' | 'source' | null => {
  if (asset.dub_rel_path) return 'dub';
  if (asset.audio_rel_path) return 'source';
  return null;
};
