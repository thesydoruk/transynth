import type { SpeakerGender } from '../../../dialog';
import type { VoiceSpeakerRefPick } from '../../../voice/voiceSpeakerRefs';

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

export type VoiceSpeakerGroup = {
  key: string;
  displayName: string;
  referencePick: VoiceSpeakerRefPick | null;
  /** Gender of the NPC this folder voices, resolved from the dialog graph. */
  gender: SpeakerGender;
  /** True when the folder name implies the opposite gender, so its clips mislead the TTS. */
  genderMismatch: boolean;
  lines: VoiceLinePreview[];
};

export type VoiceLinesListResult =
  | { ok: true; speakers: VoiceSpeakerGroup[]; totalLines: number }
  | {
      ok: false;
      reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing' | 'no_voice_files';
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
