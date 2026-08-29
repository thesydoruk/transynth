import fs from 'node:fs';
import path from 'node:path';

export type VoiceFileEntry = {
  relPath: string;
  absolutePath: string;
  fileName: string;
  formidLower6: string;
  variant: number;
  ext: 'fuz' | 'wav' | 'xwm';
};

const VOICE_FILE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav|xwm)$/i;

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Resolve `Sound/Voice/<plugin>/` relative to the plugin file location (e.g. `Data/Sound/Voice/Mod.esp`). */
export const resolveVoiceRootRel = (pluginRelPath: string): string => {
  const normalizedPlugin = normalizeRelPath(pluginRelPath);
  const pluginDir = path.dirname(normalizedPlugin);
  const pluginFileName = path.basename(normalizedPlugin);
  if (pluginDir === '.') {
    return normalizeRelPath(path.join('Sound', 'Voice', pluginFileName));
  }
  return normalizeRelPath(path.join(pluginDir, 'Sound', 'Voice', pluginFileName));
};

/** Scan `<plugin-dir>/Sound/Voice/<plugin>/` for voiced dialogue files. */
export const discoverVoiceFiles = (packageDir: string, pluginRelPath: string): VoiceFileEntry[] => {
  const voiceRelPrefix = resolveVoiceRootRel(pluginRelPath);
  const voiceRoot = path.join(packageDir, ...voiceRelPrefix.split('/'));
  if (!fs.existsSync(voiceRoot)) return [];

  const entries: VoiceFileEntry[] = [];
  const walk = (currentDir: string, relDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
        continue;
      }
      const match = entry.name.match(VOICE_FILE_RE);
      if (!match) continue;
      entries.push({
        relPath: normalizeRelPath(path.join(voiceRelPrefix, relPath)),
        absolutePath: fullPath,
        fileName: entry.name,
        formidLower6: match[1]!.substring(2).toUpperCase(),
        variant: Number.parseInt(match[2]!, 10),
        ext: match[3]!.toLowerCase() as VoiceFileEntry['ext'],
      });
    }
  };

  walk(voiceRoot, '');
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return entries;
};

/**
 * Prefer `.fuz` over loose `.xwm`/`.wav` for the same voiced line.
 *
 * The key must stay scoped to the speaker folder: one line is recorded once per
 * voice type, so `PlayerVoiceMale01/00005825_1.fuz` and its
 * `PlayerVoiceFemale01` sibling are different takes of the same text by
 * different actors. Keying on FormID + response number alone dropped one of
 * them — 42 219 of Fallout4.esm's 117 112 clips, almost all of the male
 * player's, which then never showed up and never got dubbed.
 */
export const dedupeVoiceFiles = (entries: VoiceFileEntry[]): VoiceFileEntry[] => {
  const byKey = new Map<string, VoiceFileEntry>();
  const rank = (ext: VoiceFileEntry['ext']): number => {
    if (ext === 'fuz') return 3;
    if (ext === 'xwm') return 2;
    return 1;
  };

  for (const entry of entries) {
    const dir = entry.relPath.slice(0, entry.relPath.lastIndexOf('/') + 1).toLowerCase();
    const key = `${dir}${entry.formidLower6}_${entry.variant}`;
    const existing = byKey.get(key);
    if (!existing || rank(entry.ext) > rank(existing.ext)) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
};
