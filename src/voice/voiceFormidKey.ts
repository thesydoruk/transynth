/**
 * Voice line ids in API paths: Bethesda lower-6 FormID, or Disco SHA1 stem (12 hex).
 */
export const VOICE_FORMID_KEY_RE = /^[0-9A-Fa-f]{6}([0-9A-Fa-f]{6})?$/;

export const isVoiceFormidKey = (value: string): boolean => VOICE_FORMID_KEY_RE.test(value);
