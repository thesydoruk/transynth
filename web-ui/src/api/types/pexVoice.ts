import type { SpeakerGender } from './dialogs';

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

/** Speaker row for the voice navigator — counts only, no line payloads. */
export type VoiceSpeakerSummary = {
  key: string;
  displayName: string;
  referencePick: VoiceSpeakerRefPick | null;
  gender: SpeakerGender;
  genderMismatch: boolean;
  lineCount: number;
  dubbedCount: number;
};

export type VoiceSpeakersResponse =
  | { ok: true; speakers: VoiceSpeakerSummary[]; totalLines: number }
  | { ok: false; reason: string; message: string };

export type VoiceSpeakerLinesResponse =
  | { ok: true; speakerKey: string; lines: VoiceLinePreview[] }
  | { ok: false; reason: string; message: string };

/** Playable voice lines of a mod, listed as `FORMID6:variant` keys. */
export type VoiceAvailabilityResponse =
  | { ok: true; targetLang: string; source: string[]; translation: string[]; stale: string[] }
  | { ok: false; reason: string; message: string };

export type VoiceRegenerateParams = {
  line_reference: boolean;
};

export type VoiceRegeneratePreview = {
  id: string;
  attempt: number;
  createdAt: string;
  audioUrl: string;
  params: VoiceRegenerateParams;
};
