export type VoiceRegenerateParams = {
  line_reference: boolean;
};

export type VoiceProjectSettings = VoiceRegenerateParams;

export const VOICE_SETTINGS_DEFAULTS: VoiceProjectSettings = {
  line_reference: true,
};

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';
