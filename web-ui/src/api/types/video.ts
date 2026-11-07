export type VideoAssetStatus =
  | 'registered'
  | 'uploaded'
  | 'separating'
  | 'separated'
  | 'dubbing'
  | 'dubbed'
  | 'packed'
  | 'error';

/** One cutscene video of a mod, as the import registered it from the agent's manifest. */
export type VideoAsset = {
  id: number;
  mod_id: number;
  agent_key: string | null;
  file_name: string;
  byte_size: number;
  fingerprint: string;
  duration_s: number | null;
  track_ids: number[];
  source_track_id: number | null;
  audio_rel_path: string | null;
  status: VideoAssetStatus | string;
  dub_rel_path: string | null;
  dub_version: string | null;
  packed_version: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoAudioKind = 'source' | 'speech' | 'background' | 'dub';

/** Which hosts the video stages need are up right now. */
export type VideoServices = Partial<Record<'separate' | 'asr' | 'tts', boolean>>;

export type VideoListResponse = { assets: VideoAsset[]; services: VideoServices };

/** One transcribed phrase of a video and the state of its translation. */
export type VideoSegment = {
  id: number;
  video_id: number;
  idx: number;
  start_s: number;
  end_s: number;
  speaker: string | null;
  source_text: string;
  string_id: number | null;
  take_rel_path: string | null;
  take_similarity: number | null;
  take_version: string | null;
  tempo: number | null;
  overrun: boolean;
  translation: string | null;
  translation_status: string | null;
};

/** The video and timing behind one VIDEO record, for the editor's phrase players. */
export type VideoPhraseInfo = {
  videoId: number;
  idx: number;
  startS: number;
  endS: number;
  nextStartS: number | null;
  durationS: number | null;
  hasSpeech: boolean;
  hasDub: boolean;
  takeSimilarity: number | null;
  tempo: number | null;
  overrun: boolean;
};

export type VideoJobStatus = {
  jobId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  error: string | null;
  videoId?: number;
  stage?: string;
  phrases?: number;
};
