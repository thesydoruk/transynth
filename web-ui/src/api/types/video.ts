export type VideoAssetStatus =
  | 'registered'
  | 'uploaded'
  | 'separating'
  | 'separated'
  | 'dubbing'
  | 'dubbed'
  | 'packed'
  | 'error';

/** One cutscene video of a game, as the resident agent registered it. */
export type VideoAsset = {
  id: number;
  game: string;
  agent_key: string | null;
  file_name: string;
  byte_size: number;
  fingerprint: string;
  duration_s: number | null;
  track_ids: number[];
  source_track_id: number | null;
  audio_rel_path: string | null;
  status: VideoAssetStatus | string;
  mod_id: number | null;
  dub_rel_path: string | null;
  dub_version: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoAudioKind = 'source' | 'speech' | 'background' | 'dub';
