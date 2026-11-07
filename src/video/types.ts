/**
 * Cutscene videos and their dubbing state.
 *
 * A row per video file of a mod, as the resident agent found it: the game's
 * own videos belong to the game's main master, a mod's videos to that mod,
 * exactly like MCM files. The agent uploads one audio track (the English
 * narration mixed with the score); the server separates, transcribes,
 * translates and dubs it, and the agent writes the result back into the video.
 */

export type VideoAssetStatus =
  /** Registered by the import; the audio track is still on its way. */
  | 'registered'
  /** The source audio is on the server. */
  | 'uploaded'
  | 'separating'
  /** Speech and background split, segments transcribed, the VIDEO records written. */
  | 'separated'
  | 'dubbing'
  /** `dub_rel_path` holds a finished dubbed track. */
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
  /** The mod the video file belongs to. */
  mod_id: number;
  agent_key: string | null;
  file_name: string;
  byte_size: number;
  /** sha1 of the video file, the same the agent's inventory hashes it with. */
  fingerprint: string;
  duration_s: number | null;
  /** Bink audio track ids as the container lists them (the game picks one by language). */
  track_ids: number[];
  /** The track the agent uploads, normally the English one. */
  source_track_id: number | null;
  /** Relative to `PATHS.videoUploads`; null until the upload lands. */
  audio_rel_path: string | null;
  status: VideoAssetStatus;
  dub_rel_path: string | null;
  dub_version: string | null;
  /** The dub version the agent last wrote into the video; null until it did. */
  packed_version: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

/** What the import registers (or re-registers) one video from: the agent's manifest. */
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
