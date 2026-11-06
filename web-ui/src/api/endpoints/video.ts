import { BASE, req } from '../client';
import type {
  VideoAsset,
  VideoAudioKind,
  VideoJobStatus,
  VideoListResponse,
  VideoSegment,
} from '../types/video';

const base = (game: string) => `/api/video/${encodeURIComponent(game)}`;

export const videoEndpoints = {
  list: (game: string) => req<VideoListResponse>(base(game)),
  get: (game: string, id: number) => req<{ asset: VideoAsset }>(`${base(game)}/${id}`),
  segments: (game: string, id: number) =>
    req<{ segments: VideoSegment[] }>(`${base(game)}/${id}/segments`),
  separate: (game: string, id: number) =>
    req<{ ok: true; jobId: number; videoId: number }>(`${base(game)}/${id}/separate`, {
      method: 'POST',
    }),
  separateStatus: (jobId: number) => req<VideoJobStatus>(`/api/video-separate/${jobId}`),
  stopSeparate: (jobId: number) =>
    req<{ ok: true }>(`/api/video-separate/${jobId}/stop`, { method: 'POST' }),
  /** `scope`: `all`, `changed` (default) or `segment:<idx>`. */
  dub: (game: string, id: number, scope = 'changed') =>
    req<{ ok: true; jobId: number; videoId: number }>(`${base(game)}/${id}/dub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    }),
  dubStatus: (jobId: number) => req<VideoJobStatus>(`/api/video-dub/${jobId}`),
  stopDub: (jobId: number) => req<{ ok: true }>(`/api/video-dub/${jobId}/stop`, { method: 'POST' }),
  /** The URL the player streams one audio kind of a video from, or a slice of it. */
  audioUrl: (
    game: string,
    id: number,
    kind: VideoAudioKind,
    range?: { from: number; to: number },
  ) =>
    `${BASE}${base(game)}/${id}/audio/${kind}${
      range ? `?from=${range.from.toFixed(3)}&to=${range.to.toFixed(3)}` : ''
    }`,
};
