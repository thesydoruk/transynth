import type { SpeakerGender } from '../../../dialog';
import type { VoiceSpeakerRefPick } from '../../../voice/voiceSpeakerRefs';
import type { VoiceTtsSkipReason } from '../../../voice/prepareVoiceTtsText';
import type { EffortTag } from '../../../voice/vocalEffort';
import type { EffortTagOverride } from '../../../voice/voiceEffortStore';

export type { VoiceTtsSkipReason };

export type VoiceLinePreview = {
  lineKey: string;
  infoFormidHex: string | null;
  variant: number;
  fileName: string;
  /**
   * Voice folder this take belongs to. Several speakers can share a FormID and
   * response number, so playback and dubbing need it to pick the right file.
   */
  speakerKey: string;
  /** Plugin folder under Sound/Voice the take lives in (lower-case); null when unknown. */
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
  /** ECAPA cosine vs the clone prompt; null when the take has no stored score. */
  voiceSimilarity: number | null;
  /** Effort tag in force for the take: a person's choice, else the analysis's. */
  effortTag: EffortTag | null;
  /** The tag the analysis derived, whatever a person chose. */
  effortAutoTag: EffortTag | null;
  /** A person's choice; null leaves the derived tag in force. */
  effortOverride: EffortTagOverride | null;
  /** Measured effort against the speaker's calm baseline; null when not measured. */
  effortStrength: number | null;
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
  effortAnalyzed: boolean;
  /** Analysis found enough calm lines to judge the others by; without it no line is tagged. */
  effortHasBaseline: boolean;
};

export type VoiceListErrorReason =
  | 'mod_not_found'
  | 'no_plugin_path'
  | 'plugin_missing'
  | 'no_voice_files'
  | 'speaker_not_found';

export type VoiceSpeakersListResult =
  | { ok: true; speakers: VoiceSpeakerSummary[]; totalLines: number }
  | {
      ok: false;
      reason: Exclude<VoiceListErrorReason, 'speaker_not_found'>;
      message: string;
    };

export type VoiceSpeakerLinesResult =
  | {
      ok: true;
      speakerKey: string;
      lines: VoiceLinePreview[];
      /** The game can tag lines for vocal effort at all. */
      effortTagsSupported: boolean;
      /** Tags reach synthesis: the game supports them and has them switched on. */
      effortTagsActive: boolean;
    }
  | {
      ok: false;
      reason: VoiceListErrorReason;
      message: string;
    };

/** Playable voice lines of a mod, listed as `FORMID6:variant` keys. */
export type VoiceAvailabilityResult =
  | {
      ok: true;
      targetLang: string;
      /** Lines shipped with the mod. */
      source: string[];
      /** Subset of {@link source} that also has a generated translation take. */
      translation: string[];
      /** Subset of {@link translation} whose TTS text version is stale. */
      stale: string[];
      /** Lines that must not be synthesized, keyed by `FORMID6:variant`. */
      skipReasons: Record<string, VoiceTtsSkipReason>;
      /** Weakest stored ECAPA score per `FORMID6:variant`. */
      similarities: Record<string, number>;
    }
  | {
      ok: false;
      reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing';
      message: string;
    };

export type VoiceAudioResult =
  | { ok: true; wavPath: string }
  | {
      ok: false;
      reason:
        | 'mod_not_found'
        | 'no_plugin_path'
        | 'plugin_missing'
        | 'line_not_found'
        | 'source_missing'
        | 'translation_missing'
        | 'translation_not_generated'
        | 'convert_failed';
      message: string;
    };

export type VoiceGenerateLineResult =
  | { ok: true; relPath: string; skipped: boolean }
  | {
      ok: false;
      reason:
        | 'mod_not_found'
        | 'no_plugin_path'
        | 'plugin_missing'
        | 'line_not_found'
        | 'no_translation'
        | 'no_localize_dir'
        | 'non_speech'
        | 'tts_failed';
      message: string;
    };

export type VoiceRemoveLineResult =
  | {
      ok: true;
      /** Takes deleted from the mod's localize tree; 0 when the line had none. */
      takesRemoved: number;
      /** Synthesis stamps forgotten with them. */
      stampsRemoved: number;
    }
  | {
      ok: false;
      reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing' | 'line_not_found';
      message: string;
    };

export type VoiceSpeakerRefResult =
  | { ok: true; referencePick: VoiceSpeakerRefPick | null }
  | {
      ok: false;
      reason:
        | 'mod_not_found'
        | 'no_plugin_path'
        | 'plugin_missing'
        | 'speaker_not_found'
        | 'line_not_found'
        | 'line_not_in_speaker'
        /** Orphan audio: no dialogue record, so no transcript to condition TTS on. */
        | 'line_no_record';
      message: string;
    };
