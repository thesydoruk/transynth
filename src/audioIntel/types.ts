export type AudioIntelSpeechSegment = {
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  /** Diarization label (`SPEAKER_00`…), present when the service ran speakers. */
  speaker?: string;
};

export type AudioIntelTranscript = {
  text: string;
  confidence: number | null;
  duration: number | null;
  language: string | null;
  segments: AudioIntelSpeechSegment[];
};
