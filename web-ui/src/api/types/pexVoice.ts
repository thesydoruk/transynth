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

export type VoiceTtsSkipReason =
  | 'interject_stub'
  | 'non_speech_marker'
  | 'empty_after_strip'
  | 'phonetic_vocalization';

export type VoiceLinePreview = {
  lineKey: string;
  infoFormidHex: string | null;
  variant: number;
  fileName: string;
  /** Voice-type folder; Nate and Nora share a FormID, so this picks the take. */
  speakerKey: string;
  /** Plugin folder under Sound/Voice the take lives in (lower-case). */
  originPlugin?: string | null;
  /** Source string row id — null for orphan audio with no dialogue record. */
  stringId: number | null;
  translationId: number | null;
  status: string | null;
  source: string | null;
  translation: string | null;
  isReference: boolean;
  isInheritedAudio: boolean;
  inheritedFrom: string | null;
  /** Audio whose FormID has no INFO record anywhere — cut line left in the archives. */
  isOrphanAudio: boolean;
  hasTranslationAudio: boolean;
  canGenerateVoice: boolean;
  /** Set when TTS must not run; the editor keeps only original playback. */
  ttsSkipReason: VoiceTtsSkipReason | null;
  /** Stored ECAPA cosine for the dubbed take, when known. */
  voiceSimilarity: number | null;
  /** Vocal-effort tag in force for the take: a person's choice, else the analysis's. */
  effortTag: VoiceEffortTag | null;
  /** The tag the analysis derived, whatever a person chose. */
  effortAutoTag: VoiceEffortTag | null;
  /** A person's choice; null leaves the derived tag in force. */
  effortOverride: VoiceEffortOverride | null;
  /** Measured effort against the speaker's calm baseline; null when not measured. */
  effortStrength: number | null;
};

export type VoiceEffortTag = 'shouting' | 'loud';
export type VoiceEffortOverride = VoiceEffortTag | 'none';
/** A tag choice for a line: 'auto' leaves it to the analysis. */
export type VoiceEffortChoice = 'auto' | VoiceEffortOverride;

/** Effort fields of one line, as PUT /api/mods/:id/voice/effort-override returns them. */
export type VoiceLineEffort = Pick<
  VoiceLinePreview,
  'effortTag' | 'effortAutoTag' | 'effortOverride' | 'effortStrength'
>;

export type VoiceSpeakerRefPick = {
  lineKey: string;
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
  /** Subset of {@link lineCount} with no dialogue record, so never dubbable. */
  orphanCount: number;
  /** The speaker's takes were analyzed for vocal effort. */
  effortAnalyzed?: boolean;
  /** Analysis found enough calm lines to judge the rest by; without it no line is tagged. */
  effortHasBaseline?: boolean;
};

export type VoiceSpeakersResponse =
  | { ok: true; speakers: VoiceSpeakerSummary[]; totalLines: number }
  | { ok: false; reason: string; message: string };

export type VoiceSpeakerLinesResponse =
  | {
      ok: true;
      speakerKey: string;
      lines: VoiceLinePreview[];
      /** The mod's game tags lines for vocal effort at all. */
      effortTagsSupported?: boolean;
      /** Tags reach synthesis: supported and switched on in Settings → Voice. */
      effortTagsActive?: boolean;
    }
  | { ok: false; reason: string; message: string };

/** Playable voice lines of a mod, listed as `FORMID6:variant` keys. */
export type VoiceAvailabilityResponse =
  | {
      ok: true;
      targetLang: string;
      source: string[];
      translation: string[];
      stale: string[];
      skipReasons: Record<string, VoiceTtsSkipReason>;
      /** Weakest stored ECAPA score per `FORMID6:variant`. */
      similarities?: Record<string, number>;
    }
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
  /** ECAPA cosine of this attempt against the source take; null when not scored. */
  voiceSimilarity: number | null;
  /** The effort-tag choice the attempt was made under; null when none applied. */
  effortChoice?: VoiceEffortChoice | null;
};

/** Per-line synthesis event from GET /api/mods/:id/voice/live. */
export type VoiceLiveLineEvent = {
  type: 'line_started' | 'line_done' | 'line_failed';
  modId: number;
  speakerKey: string;
  lineKey: string;
  variant: number;
  originPlugin?: string | null;
  voiceSimilarity?: number | null;
};

export type VoiceLiveSseEvent = VoiceLiveLineEvent | { type: 'ping' };
