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
 * Key for one physical dubbed clip: its path under the localize tree, without
 * the extension.
 *
 * A FormID + response number alone is ambiguous, because the same line is
 * recorded once per voice type — `PlayerVoiceMale01/00005825_1` and
 * `PlayerVoiceFemale01/00005825_1` are separate clips that need separate dubs.
 * The localize tree mirrors the source tree, so an entry's `relPath` is the key.
 */
const audioPathKey = (relPath: string): string =>
  relPath
    .replace(/\\/g, '/')
    .replace(/\.(fuz|wav|xwm)$/i, '')
    .toLowerCase();

/** Path key of the dubbed clip belonging to one source voice file. */
export const voiceEntryAudioKey = (entry: { relPath: string }): string =>
  audioPathKey(entry.relPath);

/**
 * Index every synthesized `.fuz`/`.wav` under the mod localize tree in one directory walk.
 *
 * Replaces thousands of per-line `fs.existsSync` calls when listing voice lines.
 * Holds path keys for plugin voice trees and FormID keys for Disco stems.
 */
export const buildTranslationAudioSet = (
  localizeDir: string | null,
  options: TranslationAudioIndexOptions = {},
): Set<string> => {
  const keys = new Set<string>();
  if (!localizeDir || !fs.existsSync(localizeDir)) return keys;

  const walk = (currentDir: string, relDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
        continue;
      }
      const match = entry.name.match(LOCALIZED_VOICE_RE);
      if (match) {
        keys.add(audioPathKey(relPath));
        keys.add(voiceTranslationMapKey(match[1]!.substring(2), Number.parseInt(match[2]!, 10)));
        continue;
      }
      if (options.disco && /\.wav$/i.test(entry.name)) {
        const stem = path.basename(entry.name, path.extname(entry.name));
        keys.add(voiceTranslationMapKey(discoVoiceFormidLower6(stem), 1));
      }
    }
  };

  walk(localizeDir, '');
  return keys;
};

/** Dubbed-clip check for Disco, where a stem maps to exactly one clip. */
export const hasTranslationAudio = (
  translationAudio: Set<string>,
  formidLower6: string,
  variant: number,
): boolean => translationAudio.has(voiceTranslationMapKey(formidLower6, variant));

/** Dubbed-clip check for a plugin voice tree, scoped to this file's speaker folder. */
export const hasTranslationAudioForEntry = (
  translationAudio: Set<string>,
  entry: { relPath: string },
): boolean => translationAudio.has(voiceEntryAudioKey(entry));

/** Localized clip for one source voice file, at the mirrored path (no tree walk). */
export const findLocalizedVoiceForEntry = (
  localizeDir: string | null,
  entry: { relPath: string },
): string | null => {
  if (!localizeDir) return null;
  const segments = entry.relPath
    .replace(/\\/g, '/')
    .replace(/\.(fuz|wav|xwm)$/i, '')
    .split('/');
  const stem = segments.pop();
  if (!stem) return null;
  for (const ext of ['fuz', 'wav']) {
    const candidate = path.join(localizeDir, ...segments, `${stem}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

/**
 * Find a localized `.fuz`/`.wav` by FormID + variant anywhere under the localize tree.
 *
 * Ambiguous for plugin voice trees where several speakers share a FormID — use
 * {@link findLocalizedVoiceForEntry} there and keep this for Disco stems.
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
