import fs from 'node:fs';
import path from 'node:path';
import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';

const LOCALIZED_FUZ_RE = /^([0-9A-Fa-f]{8})_(\d+)\.fuz$/i;

/**
 * Index every synthesized `.fuz` under the mod localize tree in one directory walk.
 *
 * Replaces thousands of per-line `fs.existsSync` calls when listing voice lines.
 */
export const buildTranslationAudioSet = (localizeDir: string | null): Set<string> => {
  const keys = new Set<string>();
  if (!localizeDir || !fs.existsSync(localizeDir)) return keys;

  const walk = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const match = entry.name.match(LOCALIZED_FUZ_RE);
      if (!match) continue;
      keys.add(voiceTranslationMapKey(match[1]!.substring(2), Number.parseInt(match[2]!, 10)));
    }
  };

  walk(localizeDir);
  return keys;
};

export const hasTranslationAudio = (
  translationAudio: Set<string>,
  formidLower6: string,
  variant: number,
): boolean => translationAudio.has(voiceTranslationMapKey(formidLower6, variant));
