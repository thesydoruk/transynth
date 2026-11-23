/**
 * Takes named after their line: `<8-hex INFO FormID>_<response number>.fuz`,
 * xWMA audio and the `.lip` track in one file. Fallout 4, Skyrim and every
 * earlier title; the default when a title says nothing.
 */
import { dedupeVoiceFiles, discoverVoiceFiles } from '../discoverVoiceFiles';
import { buildVoicedFuzFromTtsWav } from '../synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from '../voiceFilePaths';
import { originFromVoiceRelPath } from '../voiceOrigin';
import { voiceTranslationMapKey } from '../voiceTextRows';
import type { VoiceTakeFormat } from './types';

/** `<8-hex FormID>_<response number>.<ext>` — the Creation Kit take naming. */
const TAKE_FILE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav|lip|xwm)$/i;

/**
 * `<origin>/FORMID6:variant` for a take at `…/Sound/Voice/<origin>/<Speaker>/<file>`,
 * or null when the path is not a take.
 *
 * The origin comes from the path, so a bare file name yields an unqualified
 * `FORMID6:variant` — which never matches a Creation Engine text map.
 */
export const fuzVoiceKeyFromRelPath = (relPath: string): string | null => {
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

export const FUZ_TAKES: VoiceTakeFormat = {
  kind: 'fuz',
  extension: '.fuz',
  artifact: 'fuz',
  sidecarExtensions: [],
  needsSpeakerSex: false,

  discover: (packageDir, pluginRelPath) =>
    dedupeVoiceFiles(discoverVoiceFiles(packageDir, pluginRelPath)),

  localizedRelPath: outputLocalizedFuzRelPath,

  voiceKeyResolver: () => fuzVoiceKeyFromRelPath,

  build: async ({ game, ttsWav, workDir, fileName, text, includePreviewWav }) => {
    const built = await buildVoicedFuzFromTtsWav(game, ttsWav, workDir, fileName, text, {
      includePreviewWav,
    });
    return {
      data: built.fuzData,
      sidecars: [],
      ...(built.previewWav ? { previewWav: built.previewWav } : {}),
    };
  },
};
