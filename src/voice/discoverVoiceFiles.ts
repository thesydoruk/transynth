import fs from 'node:fs';
import path from 'node:path';
import { readPluginMasterNames } from '../formats/esp';
import { normalizeVoiceOrigin } from './voiceOrigin';

export type VoiceFileEntry = {
  relPath: string;
  absolutePath: string;
  fileName: string;
  lineKey: string;
  variant: number;
  /** `ogg` is a take a game stores inside a container, unpacked for playback. */
  ext: 'fuz' | 'wav' | 'xwm' | 'ogg';
  /**
   * Plugin that owns the line, lower-cased: the folder under `Sound/Voice/`.
   * Set for Creation Engine takes; games without an origin notion leave it out.
   */
  originPlugin?: string;
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

/** `Sound/Voice/` next to the plugin — the parent of every origin folder. */
const resolveVoiceTreeRel = (pluginRelPath: string): string =>
  normalizeRelPath(path.dirname(resolveVoiceRootRel(pluginRelPath)));

/**
 * Origin folders the plugin's takes may sit in: its own and its TES4 masters'.
 * Null when the plugin file cannot be read, and then every folder is walked.
 */
const allowedVoiceOrigins = (packageDir: string, pluginRelPath: string): Set<string> | null => {
  const pluginPath = path.join(packageDir, ...normalizeRelPath(pluginRelPath).split('/'));
  if (!fs.existsSync(pluginPath)) return null;
  let masters: string[];
  try {
    masters = readPluginMasterNames(pluginPath);
  } catch {
    return null;
  }
  return new Set([path.basename(pluginRelPath), ...masters].map(normalizeVoiceOrigin));
};

/**
 * Scan `<plugin-dir>/Sound/Voice/<origin>/` for voiced dialogue files.
 *
 * The plugin's own folder is walked and so are its masters': a patch keeps its
 * fixed takes under the master it overrides (`Sound/Voice/Fallout4.esm/…`),
 * and the game looks them up there. Folders of plugins that are neither — the
 * DLC folders beside `Fallout4.esm` in a game's Data directory, a sibling
 * add-on — belong to someone else. Folder names are matched by what they are,
 * so a folder whose case differs from the plugin file name is found too.
 */
export const discoverVoiceFiles = (packageDir: string, pluginRelPath: string): VoiceFileEntry[] => {
  const treeRel = resolveVoiceTreeRel(pluginRelPath);
  const treeRoot = path.join(packageDir, ...treeRel.split('/'));
  if (!fs.existsSync(treeRoot)) return [];
  const allowed = allowedVoiceOrigins(packageDir, pluginRelPath);

  const entries: VoiceFileEntry[] = [];
  const walk = (currentDir: string, relDir: string, origin: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = `${relDir}/${entry.name}`;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath, origin);
        continue;
      }
      const match = entry.name.match(VOICE_FILE_RE);
      if (!match) continue;
      entries.push({
        relPath,
        absolutePath: fullPath,
        fileName: entry.name,
        lineKey: match[1]!.substring(2).toUpperCase(),
        variant: Number.parseInt(match[2]!, 10),
        ext: match[3]!.toLowerCase() as VoiceFileEntry['ext'],
        originPlugin: origin,
      });
    }
  };

  for (const originDir of fs.readdirSync(treeRoot, { withFileTypes: true })) {
    if (!originDir.isDirectory()) continue;
    if (allowed && !allowed.has(normalizeVoiceOrigin(originDir.name))) continue;
    walk(
      path.join(treeRoot, originDir.name),
      `${treeRel}/${originDir.name}`,
      normalizeVoiceOrigin(originDir.name),
    );
  }
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
    const key = `${dir}${entry.lineKey}_${entry.variant}`;
    const existing = byKey.get(key);
    if (!existing || rank(entry.ext) > rank(existing.ext)) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
};
