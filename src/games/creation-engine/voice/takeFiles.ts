import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';

/** `<8-hex FormID>_<response number>.<ext>` — the Creation Kit take naming. */
const TAKE_FILE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav|lip|xwm)$/i;

/** `FORMID6:variant` for a take file name, or null when it is not a take. */
export const creationEngineVoiceKeyFromFileName = (fileName: string): string | null => {
  const match = fileName.match(TAKE_FILE_RE);
  if (!match) return null;
  return voiceTranslationMapKey(match[1]!.slice(-6), Number.parseInt(match[2]!, 10));
};
