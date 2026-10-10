/**
 * Voice line ids in API paths and stored speaker-reference picks.
 *
 * Every game keys its takes differently — a Bethesda lower-6 FormID, Disco's
 * 12-hex stem hash, The Witcher 3's decimal string id — so this checks only
 * what is safe to accept: a short run of ASCII letters and digits, nothing a
 * path or query could be bent with. Whether the line exists is the adapter's
 * answer.
 */
const VOICE_FORMID_KEY_RE = /^[0-9A-Za-z]{1,32}$/;

export const isVoiceFormidKey = (value: string): boolean => VOICE_FORMID_KEY_RE.test(value);
