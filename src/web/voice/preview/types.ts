import type { SpeakerGender } from '../../../dialog';
import type { VoiceSpeakerRefPick } from '../../../voice/voiceSpeakerRefs';

export type VoiceLinePreview = {
  formidLower6: string;
  infoFormidHex: string | null;
  variant: number;
  fileName: string;
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
  | { ok: true; speakerKey: string; lines: VoiceLinePreview[] }
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
        | 'line_not_in_speaker';
      message: string;
    };
