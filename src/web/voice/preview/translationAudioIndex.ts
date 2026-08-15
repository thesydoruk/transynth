import fs from 'node:fs';
import path from 'node:path';
import { discoVoiceFormidLower6 } from '../../../voice/disco/discoverDiscoVoiceFiles';
import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';

const LOCALIZED_VOICE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav)$/i;

export type TranslationAudioIndexOptions = {
  /** Index Disco Audio/*.wav by stem SHA1 FormID (variant 1). */
  disco?: boolean;
};

/**
 * Index every synthesized `.fuz`/`.wav` under the mod localize tree in one directory walk.
 *
 * Replaces thousands of per-line `fs.existsSync` calls when listing voice lines.
 */
export const buildTranslationAudioSet = (
  localizeDir: string | null,
  options: TranslationAudioIndexOptions = {},
): Set<string> => {
  const keys = new Set<string>();
  if (!localizeDir || !fs.existsSync(localizeDir)) return keys;

  const walk = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const match = entry.name.match(LOCALIZED_VOICE_RE);
      if (match) {
        keys.add(voiceTranslationMapKey(match[1]!.substring(2), Number.parseInt(match[2]!, 10)));
        continue;
      }
      if (options.disco && /\.wav$/i.test(entry.name)) {
        const stem = path.basename(entry.name, path.extname(entry.name));
        keys.add(voiceTranslationMapKey(discoVoiceFormidLower6(stem), 1));
      }
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

/**
 * Find a localized `.fuz`/`.wav` by FormID + variant anywhere under the localize tree.
 */
export const findLocalizedVoiceAbsPath = (
  localizeDir: string | null,
  formidLower6: string,
  variant: number,
  options: TranslationAudioIndexOptions = {},
): string | null => {
  if (!localizeDir || !fs.existsSync(localizeDir)) return null;

  const want = formidLower6.toUpperCase();
  let found: string | null = null;
  const walk = (currentDir: string): boolean => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (walk(fullPath)) return true;
        continue;
      }
      const match = entry.name.match(LOCALIZED_VOICE_RE);
      if (match) {
        if (match[1]!.substring(2).toUpperCase() !== want) continue;
        if (Number.parseInt(match[2]!, 10) !== variant) continue;
        found = fullPath;
        return true;
      }
      if (options.disco && variant === 1 && /\.wav$/i.test(entry.name)) {
        const stem = path.basename(entry.name, path.extname(entry.name));
        if (discoVoiceFormidLower6(stem).toUpperCase() !== want) continue;
        found = fullPath;
        return true;
      }
    }
    return false;
  };
  walk(localizeDir);
  return found;
};
