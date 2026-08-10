export type VoiceRegenerateParams = {
  /** Local voice reference from the same line (else selected-line local). */
  line_reference: boolean;
  /** Allow global + selected-line local refs (off → only this line's game audio). */
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
