export type AudioIntelSpeechSegment = {
  start: number;
  end: number;
  text: string;
  confidence: number | null;
};

export type AudioIntelTranscript = {
  text: string;
  confidence: number | null;
  duration: number | null;
  language: string | null;
  segments: AudioIntelSpeechSegment[];
};
