import { BASE, req } from '../client';
import type {
  VideoAsset,
  VideoAudioKind,
  VideoJobStatus,
  VideoListResponse,
  VideoPhraseInfo,
  VideoSegment,
} from '../types/video';

const base = (modId: number) => `/api/mods/${modId}/video`;

/** A mod's cutscene videos: the media tab of the voice editor and the phrase players. */
export const videoEndpoints = {
  list: (modId: number) => req<VideoListResponse>(base(modId)),
  get: (modId: number, id: number) => req<{ asset: VideoAsset }>(`${base(modId)}/${id}`),
  segments: (modId: number, id: number) =>
    req<{ segments: VideoSegment[] }>(`${base(modId)}/${id}/segments`),
  phrase: (modId: number, stringId: number) =>
    req<VideoPhraseInfo>(`${base(modId)}/phrase/${stringId}`),
  separate: (modId: number, id: number) =>
    req<{ ok: true; jobId: number; videoId: number }>(`${base(modId)}/${id}/separate`, {
      method: 'POST',
    }),
  separateStatus: (jobId: number) => req<VideoJobStatus>(`/api/video-separate/${jobId}`),
  stopSeparate: (jobId: number) =>
    req<{ ok: true }>(`/api/video-separate/${jobId}/stop`, { method: 'POST' }),
  /** `scope`: `all`, `changed` (default) or `segment:<idx>`. */
  dub: (modId: number, id: number, scope = 'changed') =>
    req<{ ok: true; jobId: number; videoId: number }>(`${base(modId)}/${id}/dub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    }),
  dubStatus: (jobId: number) => req<VideoJobStatus>(`/api/video-dub/${jobId}`),
  stopDub: (jobId: number) => req<{ ok: true }>(`/api/video-dub/${jobId}/stop`, { method: 'POST' }),
  /** Write the finished dub into the video again (a dub does this by itself when it ends). */
  pack: (modId: number, id: number) =>
    req<{ ok: true; jobId: number; videoId: number }>(`${base(modId)}/${id}/pack`, {
      method: 'POST',
    }),
  packStatus: (jobId: number) => req<VideoJobStatus>(`/api/video-pack/${jobId}`),
  /** The URL the player streams one audio kind of a video from, or a slice of it. */
  audioUrl: (
    modId: number,
    id: number,
    kind: VideoAudioKind,
    range?: { from: number; to: number },
  ) =>
    `${BASE}${base(modId)}/${id}/audio/${kind}${
      range ? `?from=${range.from.toFixed(3)}&to=${range.to.toFixed(3)}` : ''
    }`,
};
