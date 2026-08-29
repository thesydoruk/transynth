/**
 * Discover Disco Final Cut reference `.wav` files under language-folder Audio/.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { discoAudioDir, discoverDiscoLangFolders, listWavFilesRecursive } from '../../formats/po';
import { resolveDiscoExtractRoot } from '../../import/mod/discoPoLocales';
import { resolveModImportExtractRoot } from '../../modStorage';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { crushDiscoVoiceToken, discoSpeakerKeyFromStem, discoWavStemAsciiScore } from './voiceStem';

export { discoSpeakerKeyFromStem } from './voiceStem';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/**
 * Stable id from wav stem. 12 hex (48 bits) avoids the 6-hex collisions that
 * mixed unrelated Disco lines in the voice editor.
 */
export const discoVoiceFormidLower6 = (stem: string): string =>
  crypto.createHash('sha1').update(stem.toLowerCase()).digest('hex').slice(0, 12).toUpperCase();

/** Speaker key for a Disco voice file (`Kim Kitsuragi-YARD-1.wav` → `Kim Kitsuragi`). */
export const discoVoiceSpeakerKey = (entry: VoiceFileEntry): string =>
  discoSpeakerKeyFromStem(path.basename(entry.fileName, path.extname(entry.fileName)));

/** Group Disco wavs by the speaker token in the stem. */
export const groupDiscoVoiceFilesBySpeaker = (
  entries: VoiceFileEntry[],
): Map<string, VoiceFileEntry[]> => {
  const bySpeaker = new Map<string, VoiceFileEntry[]>();
  for (const entry of entries) {
    const speaker = discoVoiceSpeakerKey(entry);
    const list = bySpeaker.get(speaker) ?? [];
    list.push(entry);
    bySpeaker.set(speaker, list);
  }
  return bySpeaker;
};

/** Pack root for Disco Audio/ + language folders. */
export const resolveDiscoVoiceExtractRoot = (pluginPath: string): string | null => {
  const fromStorage = resolveModImportExtractRoot(pluginPath);
  if (fromStorage) return fromStorage;
  if (!pluginPath || !fs.existsSync(pluginPath)) return null;
  return resolveDiscoExtractRoot(pluginPath);
};

/** Preferred Final Cut language folder (English, else first with .po files). */
export const resolveDiscoPreferredLangFolder = (extractRoot: string): string | null => {
  const folders = discoverDiscoLangFolders(extractRoot);
  if (folders.length === 0) return null;
  const preferred =
    folders.find((f) => f.locale === 'en') ??
    folders.find((f) => /english/i.test(f.folderName)) ??
    folders[0]!;
  return preferred.absPath;
};

/** Build a voice-file entry from a persisted clip + language-folder root. */
export const discoVoiceFileEntryFromClip = (
  langFolder: string,
  clip: { relPath: string; formidLower12: string; wavStem: string },
): VoiceFileEntry => {
  const relPath = normalizeRelPath(clip.relPath);
  const fileName = path.basename(relPath) || `${clip.wavStem}.wav`;
  return {
    relPath,
    absolutePath: path.join(langFolder, relPath),
    fileName,
    formidLower6: clip.formidLower12.toUpperCase(),
    variant: 1,
    ext: 'wav',
  };
};

/** Prefer English language folder Audio/, else first folder that has wavs. */
export const discoverDiscoVoiceFiles = (extractRoot: string): VoiceFileEntry[] => {
  const folders = discoverDiscoLangFolders(extractRoot);
  if (folders.length === 0) return [];

  const preferred =
    folders.find((f) => f.locale === 'en') ??
    folders.find((f) => /english/i.test(f.folderName)) ??
    folders[0]!;

  const candidates = [preferred, ...folders.filter((f) => f.absPath !== preferred.absPath)];
  for (const folder of candidates) {
    const audioDir = discoAudioDir(folder.absPath);
    const wavs = listWavFilesRecursive(audioDir);
    if (wavs.length === 0) continue;

    const byStemKey = new Map<string, VoiceFileEntry>();
    for (const absPath of wavs) {
      const stem = path.basename(absPath, path.extname(absPath));
      if (stem.includes('\uFFFD')) continue;
      const relUnderAudio = path.relative(audioDir, absPath).split(path.sep).join('/');
      const entry: VoiceFileEntry = {
        relPath: normalizeRelPath(`Audio/${relUnderAudio}`),
        absolutePath: absPath,
        fileName: path.basename(absPath),
        formidLower6: discoVoiceFormidLower6(stem),
        variant: 1,
        ext: 'wav',
      };
      const key = crushDiscoVoiceToken(stem);
      const prev = byStemKey.get(key);
      const prevStem = prev ? path.basename(prev.fileName, path.extname(prev.fileName)) : '';
      if (!prev || discoWavStemAsciiScore(stem) > discoWavStemAsciiScore(prevStem)) {
        byStemKey.set(key, entry);
      }
    }
    const entries = [...byStemKey.values()];
    entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return entries;
  }

  return [];
};
