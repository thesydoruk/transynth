/**
 * Cutscene videos and their dubbing state.
 *
 * A row per video file of a mod, as the resident agent found it: the game's
 * own videos belong to the game's main master, a mod's videos to that mod,
 * exactly like MCM files. The agent uploads the file itself; the server reads
 * the narration out of it, separates, transcribes, translates and dubs it,
 * writes the dub back into a copy of the video, and the agent delivers the
 * dubbed videos to the mod manager as one archive.
 */

export type VideoAssetStatus =
  /** Registered by the import; the video file is still on its way. */
  | 'registered'
  /** The file and its narration track are on the server. */
  | 'uploaded'
  | 'separating'
  /** Speech and background split, segments transcribed, the VIDEO records written. */
  | 'separated'
  | 'dubbing'
  /** `dub_rel_path` holds a finished dubbed track. */
  | 'dubbed'
  /** The dub is being written into the video (bethesda-tools). */
  | 'packing'
  /** The asset's own copy of the video carries the dub; the agent can deliver it. */
  | 'packed'
  | 'error';

export const VIDEO_ASSET_STATUSES: readonly VideoAssetStatus[] = [
  'registered',
  'uploaded',
  'separating',
  'separated',
  'dubbing',
  'dubbed',
  'packing',
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
  /** The track the narration is read from, normally the English one. */
  source_track_id: number | null;
  /** Relative to `PATHS.videoUploads`; null until the file is on the server. */
  audio_rel_path: string | null;
  status: VideoAssetStatus;
  dub_rel_path: string | null;
  dub_version: string | null;
  /** The dub version written into the asset's copy of the video; null until one was. */
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
  agentKey: string | null;
};

/** What the server reads out of the file once it has it. */
export type VideoAssetProbe = {
  durationS: number | null;
  trackIds: number[];
  sourceTrackId: number | null;
};

/** The audio kinds a video can serve. */
export type VideoAudioKind = 'source' | 'speech' | 'background' | 'dub';

export const VIDEO_AUDIO_KINDS: readonly VideoAudioKind[] = [
  'source',
  'speech',
  'background',
  'dub',
];
