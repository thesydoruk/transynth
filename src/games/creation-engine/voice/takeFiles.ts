import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';
import { originFromVoiceRelPath } from '../../../voice/voiceOrigin';

/** `<8-hex FormID>_<response number>.<ext>` — the Creation Kit take naming. */
const TAKE_FILE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav|lip|xwm)$/i;

/**
 * `<origin>/FORMID6:variant` for a take at `…/Sound/Voice/<origin>/<Speaker>/<file>`,
 * or null when the path is not a take.
 *
 * The origin comes from the path, so a bare file name yields an unqualified
 * `FORMID6:variant` — which never matches a Creation Engine text map.
 */
export const creationEngineVoiceKeyFromRelPath = (relPath: string): string | null => {
  const normalized = relPath.replace(/\\/g, '/');
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  const match = fileName.match(TAKE_FILE_RE);
  if (!match) return null;
  return voiceTranslationMapKey(
    match[1]!.slice(-6),
    Number.parseInt(match[2]!, 10),
    originFromVoiceRelPath(normalized),
  );
};
