import fs from 'node:fs';
import path from 'node:path';
import type { GameVoiceAdapter } from '../../../games/contract';
import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';

/** Key of one dubbed clip by FormID and response number, for games that use them. */
const LOCALIZED_VOICE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav)$/i;

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
 * Keys come from the game's own take-naming rules.
 */
export const buildTranslationAudioSet = (
  localizeDir: string | null,
  voice: Pick<GameVoiceAdapter, 'voiceKeyFromFileName'>,
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
      const lineKey = voice.voiceKeyFromFileName(entry.name);
      if (!lineKey) continue;
      keys.add(lineKey);
      // Games whose takes mirror a source tree also need the path key, because
      // one line can have a separate take per speaker folder.
      if (LOCALIZED_VOICE_RE.test(entry.name)) keys.add(audioPathKey(relPath));
    }
  };

  walk(localizeDir, '');
  return keys;
};

/** Dubbed-clip check for a game where one line maps to exactly one take. */
export const hasTranslationAudio = (
  translationAudio: Set<string>,
  lineKey: string,
  variant: number,
): boolean => translationAudio.has(voiceTranslationMapKey(lineKey, variant));

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
