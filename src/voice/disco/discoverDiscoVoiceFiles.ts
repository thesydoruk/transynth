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

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Stable 6-hex id derived from wav stem (fits voice_synthesis_state keys). */
export const discoVoiceFormidLower6 = (stem: string): string =>
  crypto.createHash('sha1').update(stem.toLowerCase()).digest('hex').slice(0, 6).toUpperCase();

/** Speaker folder token from asset name (`Kim Kitsuragi-YARD-1` → `Kim Kitsuragi`). */
export const discoSpeakerKeyFromStem = (stem: string): string => {
  const cut = stem.split(/[-_/]/)[0]?.trim();
  return cut && cut.length > 0 ? cut : 'Unknown';
};

/** Pack root for Disco Audio/ + language folders. */
export const resolveDiscoVoiceExtractRoot = (pluginPath: string): string | null => {
  const fromStorage = resolveModImportExtractRoot(pluginPath);
  if (fromStorage) return fromStorage;
  if (!pluginPath || !fs.existsSync(pluginPath)) return null;
  return resolveDiscoExtractRoot(pluginPath);
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

    const entries: VoiceFileEntry[] = wavs.map((absPath) => {
      const stem = path.basename(absPath, path.extname(absPath));
      const relUnderAudio = path.relative(audioDir, absPath).split(path.sep).join('/');
      return {
        relPath: normalizeRelPath(`Audio/${relUnderAudio}`),
        absolutePath: absPath,
        fileName: path.basename(absPath),
        formidLower6: discoVoiceFormidLower6(stem),
        variant: 1,
        ext: 'wav' as const,
      };
    });
    entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return entries;
  }

  return [];
};
