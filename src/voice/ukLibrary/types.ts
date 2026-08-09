import type { UkVoiceAge } from './ageBand';

/** Gender label stored for library voices and character matching. */
export type UkVoiceGender = 'male' | 'female' | 'unknown';

export type { UkVoiceAge };

/** Upstream corpus that supplied a library clip. */
export type UkVoiceSource = 'opentts' | 'common_voice';

export type UkVoiceLibraryRow = {
  id: string;
  source: UkVoiceSource;
  displayName: string;
  description: string | null;
  gender: UkVoiceGender;
  /** CV demographic age bucket (teens…nineties) or unknown. */
  age: UkVoiceAge;
  audioRelPath: string;
  transcript: string;
  license: string;
  durationSec: number | null;
  qualityScore: number | null;
  genderSource: string | null;
  meanF0Hz: number | null;
  analyzedAt: string | null;
  /** Stable speaker key (opentts id or CV client_id). */
  speakerKey: string | null;
  meta: Record<string, unknown>;
};

export type CharacterUkVoiceLink = {
  characterKey: string;
  voiceId: string;
  assignReason: string | null;
  assignedBy: string;
  assignedAt: string;
};

/** One voice-folder character aggregated across mods. */
export type UkVoiceCharacter = {
  characterKey: string;
  displayName: string | null;
  gender: UkVoiceGender;
  /** Inferred age band for mapping (from folder name heuristics). */
  age: UkVoiceAge;
  /** Median F0 from sampled EN game clips (`character_voice_profiles`). */
  meanF0Hz: number | null;
  modCount: number;
  lineCount: number;
  linkedVoiceId: string | null;
};

/** Proposed auto-map row shown to the user before apply. */
export type UkVoiceAutoMapProposal = {
  characterKey: string;
  characterGender: UkVoiceGender;
  characterAge: UkVoiceAge;
  displayName: string | null;
  modCount: number;
  voiceId: string;
  voiceName: string;
  voiceGender: UkVoiceGender;
  voiceAge: UkVoiceAge;
  voiceSource: UkVoiceSource;
  reason: string;
};
