import { BASE, req } from '../client';
import type { VideoAsset, VideoAudioKind } from '../types/video';

export const videoEndpoints = {
  list: (game: string) => req<{ assets: VideoAsset[] }>(`/api/video/${encodeURIComponent(game)}`),
  get: (game: string, id: number) =>
    req<{ asset: VideoAsset }>(`/api/video/${encodeURIComponent(game)}/${id}`),
  /** The URL the player streams one audio kind of a video from. */
  audioUrl: (game: string, id: number, kind: VideoAudioKind) =>
    `${BASE}/api/video/${encodeURIComponent(game)}/${id}/audio/${kind}`,
};
