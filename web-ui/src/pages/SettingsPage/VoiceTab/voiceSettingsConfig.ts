export type VoiceRegenerateParams = {
  /** Global voice reference (open UA library). */
  global_reference: boolean;
  /** Local voice reference (in-game same-line or selected-line). */
  local_reference: boolean;
  /** When local is on: same-line local (else selected-line local). */
  line_reference: boolean;
};

export type VoiceProjectSettings = {
  line_reference: boolean;
};

export const VOICE_SETTINGS_DEFAULTS: VoiceProjectSettings = {
  line_reference: true,
};

export const VOICE_REGENERATE_DEFAULTS: VoiceRegenerateParams = {
  global_reference: true,
  local_reference: true,
  line_reference: true,
};

/** Normalize API / session params; migrates legacy `character_reference`. */
export const normalizeVoiceRegenerateParams = (
  params: Partial<VoiceRegenerateParams> & { character_reference?: boolean },
): VoiceRegenerateParams => {
  if ('global_reference' in params || 'local_reference' in params) {
    return {
      global_reference: params.global_reference !== false,
      local_reference: params.local_reference !== false,
      line_reference: Boolean(params.line_reference),
    };
  }
  const characterOn = params.character_reference !== false;
  return {
    global_reference: characterOn,
    local_reference: characterOn,
    line_reference: Boolean(params.line_reference),
  };
};

export const VOICE_REGENERATE_KEEP_CURRENT_ID = 'current';
