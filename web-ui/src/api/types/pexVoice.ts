/** One RAG reference example shown in the editor's "RAG examples" panel. */
export type RagSuggestion = {
  source: string;
  translation: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  match_method: 'exact' | 'numeric' | 'punct_norm' | 'fuzzy' | 'embedding';
  similarity: number;
};

export type PexSourceLine = {
  lineNumber: number;
  text: string;
  highlight: boolean;
};

export type PexSourceSnippet = {
  scriptLabel: string;
  headerSourceFile: string | null;
  matchLineNumbers: number[];
  contextLines: PexSourceLine[];
};

export type PexSourceSnippetResponse =
  | { ok: true; snippet: PexSourceSnippet }
  | {
      ok: false;
      reason: string;
      message: string;
    };

export type VoiceLinePreview = {
  formidLower6: string;
  infoFormidHex: string | null;
  variant: number;
  fileName: string;
  source: string | null;
  translation: string | null;
  isReference: boolean;
  isInheritedAudio: boolean;
  inheritedFrom: string | null;
  hasTranslationAudio: boolean;
  canGenerateVoice: boolean;
};

export type VoiceSpeakerRefPick = {
  formidLower6: string;
  variant: number;
};

export type VoiceSpeakerGroup = {
  key: string;
  displayName: string;
  referencePick: VoiceSpeakerRefPick | null;
  lines: VoiceLinePreview[];
};

export type VoiceLinesResponse =
  | { ok: true; speakers: VoiceSpeakerGroup[]; totalLines: number }
  | { ok: false; reason: string; message: string };

/** Playable voice lines of a mod, listed as `FORMID6:variant` keys. */
export type VoiceAvailabilityResponse =
  | { ok: true; targetLang: string; source: string[]; translation: string[] }
  | { ok: false; reason: string; message: string };

export type VoiceRegenerateParams = {
  backend: 'xtts' | 'fish-speech';
  line_reference: boolean;
  speed: number;
  length_penalty: number;
  temperature: number;
  repetition_penalty: number;
  top_p: number;
  top_k: number;
  enable_text_splitting: boolean;
};

export type VoiceRegeneratePreview = {
  id: string;
  attempt: number;
  createdAt: string;
  audioUrl: string;
  params: VoiceRegenerateParams;
};
