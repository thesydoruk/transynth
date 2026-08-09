export type VoiceRegenerateParams = {
  line_reference: boolean;
  /** When false, skip character / UK-library reference audio. */
  character_reference: boolean;
};

export type VoiceProjectSettings = {
  line_reference: boolean;
};

export const VOICE_SETTINGS_DEFAULTS: VoiceProjectSettings = {
  line_reference: true,
};

export const VOICE_REGENERATE_DEFAULTS: VoiceRegenerateParams = {
  line_reference: true,
  character_reference: true,
};

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';
