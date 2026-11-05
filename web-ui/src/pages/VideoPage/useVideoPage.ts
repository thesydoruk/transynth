import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import type { VideoAsset } from '../../api';

const BUSY = new Set(['separating', 'dubbing']);

/** The cutscene videos of a game; polls faster while a job runs on one of them. */
export const useVideoPage = (gameId: string) => {
  const assets = useQuery({
    queryKey: ['video-assets', gameId],
    queryFn: () => api.video.list(gameId),
    enabled: !!gameId,
    refetchInterval: (query) =>
      query.state.data?.assets.some((a) => BUSY.has(a.status)) ? 5000 : 30000,
  });
  return {
    assets: assets.data?.assets ?? [],
    isLoading: assets.isLoading,
    error: assets.error instanceof Error ? assets.error.message : null,
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
