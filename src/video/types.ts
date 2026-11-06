/**
 * Cutscene videos and their dubbing state.
 *
 * A row per video file of a game as the resident agent found it in the install
 * folder. The agent uploads one audio track (the English narration mixed with
 * the score); the server separates, transcribes, translates and dubs it, and
 * the agent writes the result back into the video.
 */
import type { GameId } from '../types';

export type VideoAssetStatus =
  /** Registered by the agent; the audio track is still on its way. */
  | 'registered'
  /** The source audio is on the server. */
  | 'uploaded'
  | 'separating'
  /** Speech and background split, segments transcribed, the Video mod filled. */
  | 'separated'
  | 'dubbing'
  /** `dub_rel_path` holds a finished Ukrainian track. */
  | 'dubbed'
  /** The agent wrote the dub into the video and delivered the videopack. */
  | 'packed'
  | 'error';

export const VIDEO_ASSET_STATUSES: readonly VideoAssetStatus[] = [
  'registered',
  'uploaded',
  'separating',
  'separated',
  'dubbing',
  'dubbed',
  'packed',
  'error',
];

export type VideoAssetRow = {
  id: number;
  game: GameId;
  agent_key: string | null;
  file_name: string;
  byte_size: number;
  /** Size, mtime and the first MiB of the file: cheap, and changes when Vortex swaps the file. */
  fingerprint: string;
  duration_s: number | null;
  /** Bink audio track ids as the container lists them (the game picks one by language). */
  track_ids: number[];
  /** The track the agent uploaded, normally the English one. */
  source_track_id: number | null;
  /** Relative to `PATHS.videoUploads`; null until the upload lands. */
  audio_rel_path: string | null;
  status: VideoAssetStatus;
  mod_id: number | null;
  dub_rel_path: string | null;
  dub_version: string | null;
  /** The dub version the agent last wrote into the video; null until it did. */
  packed_version: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

/** What the agent sends to register (or re-register) one video. */
export type VideoAssetRegistration = {
  fileName: string;
  byteSize: number;
  fingerprint: string;
  durationS: number | null;
  trackIds: number[];
  sourceTrackId: number | null;
  agentKey: string | null;
};

/** The audio kinds a video can serve. */
export type VideoAudioKind = 'source' | 'speech' | 'background' | 'dub';

export const VIDEO_AUDIO_KINDS: readonly VideoAudioKind[] = [
  'source',
  'speech',
  'background',
  'dub',
];
