import fs from 'node:fs';
import path from 'node:path';
import type { EspStringRow } from '../../formats/esp';
import { logImport } from '../../logging/loggers';
import { findDirAnyCase } from '../../voice/discoverVoiceFiles';
import { loadInfoWemIndex, lookupWemTakeLine } from '../../voice/infoWemIds';

const buildNpcNameMap = (
  espRows: EspStringRow[],
  strMap?: Map<number, string> | null,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of espRows) {
    if (row.signature !== 'NPC_' || row.path !== 'FULL') continue;
    if (row.isLstringId) {
      if (!strMap) continue;
      const id = parseInt(row.text, 10);
      const name = strMap.get(id);
      if (name) map.set(row.formId, name);
    } else {
      map.set(row.formId, row.text);
    }
  }
  return map;
};

/**
 * Build a map from INFO record FormID → speaker NPC FormID.
 *
 * Iterates espRows and collects the speakerFormId value that EspReader
 * populates from the ANAM subrecord of each INFO record.
 *
 * @param espRows - Rows returned by EspReader.extractStrings().
 */
const buildSpeakerFormIdMap = (espRows: EspStringRow[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of espRows) {
    if (row.speakerFormId) map.set(row.formId, row.speakerFormId);
  }
  return map;
};

/**
 * Clean a voice directory name into a human-readable speaker label.
 *
 * Typical folder names follow `<ModPrefix>_<Name>Voice` or `NPC[FM]<Name>`.
 * The function strips known prefixes/suffixes and inserts spaces at
 * CamelCase boundaries.
 */
const cleanVoiceFolderName = (name: string): string => {
  let cleaned = name.replace(/Voice$/i, '');
  // Strip NPC gender prefix (NPCFPiper → Piper)
  cleaned = cleaned.replace(/^NPC[FM]/i, '');
  // If underscore remains, take the part after the last one (e.g. DP_Stella → Stella)
  if (cleaned.includes('_')) {
    cleaned = cleaned.substring(cleaned.lastIndexOf('_') + 1);
  }
  // Insert spaces before CamelCase boundaries (TinaDeLuca → Tina De Luca)
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Insert spaces before digit runs (Male01 → Male 01)
  cleaned = cleaned.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  if (/^Player Voice (Female|Male) \d+$/i.test(cleaned.trim())) {
    return 'Player';
  }
  return cleaned || name;
};

/**
 * Build a lookup from INFO record to the voice folder its audio ships in.
 *
 * FO4 voice files live at `Sound/Voice/<Plugin>/<SpeakerFolder>/<FormID>_<N>.fuz`.
 * Most quest-based INFO records lack an ANAM subrecord (speaker is determined
 * by quest aliases), so voice file paths are the most reliable fallback for
 * identifying the speaker.
 *
 * The returned map keys are the **lower 6 hex digits** of the INFO FormID
 * (stripping the 2-char load-order prefix) because CK exports voice files
 * with a hard-coded `00` prefix regardless of the plugin's actual load index.
 *
 * @param espPath - Absolute path to the plugin file.
 * @returns Map from lower-6-hex FormID → raw voice folder name.
 */
const buildVoiceFolderMap = (espPath: string): Map<string, string> => {
  // Keyed by lower-6 only: speaker display names, last-wins across origins.
  const map = new Map<string, string>();
  const modDir = path.dirname(espPath);
  const pluginName = path.basename(espPath);
  const voiceRoot = findDirAnyCase(modDir, `Sound/Voice/${pluginName}`);

  if (!voiceRoot) return map;

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(voiceRoot, { withFileTypes: true });
  } catch {
    return map;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    let files: string[];
    try {
      files = fs.readdirSync(path.join(voiceRoot, dir.name));
    } catch {
      continue;
    }

    for (const file of files) {
      const match = file.match(/^([0-9A-Fa-f]{8})_\d+\.(fuz|wav|xwm)$/i);
      if (!match) continue;
      // Strip the 2-char load-order prefix → lower 6 hex digits as key
      const lower6 = match[1].substring(2).toUpperCase();
      if (!map.has(lower6)) {
        map.set(lower6, dir.name);
      }
    }
  }

  logImport.debug(`Voice folder map: ${map.size} entries from ${voiceRoot}`);
  return map;
};

/** Response number → voice folders holding a take of it, per lower-6 INFO FormID. */
type TakeFoldersByLine = Map<string, Map<number, Set<string>>>;

/**
 * Voice folders of takes named by their WEM id (Starfield):
 * `Sound/Voice/<Plugin>/<VoiceType>/<8 hex>.wem`. The name says nothing of the
 * line, so the plugin's own WEM index (read only once a `.wem` turns up) maps
 * each file to its INFO and response. Unlike {@link buildVoiceFolderMap} every
 * folder is kept: one generic line is often recorded by dozens of voice types.
 *
 * @returns lower-6 INFO FormID → response number → folder names.
 */
const buildWemTakeFolders = (espPath: string): TakeFoldersByLine => {
  const map: TakeFoldersByLine = new Map();
  const pluginName = path.basename(espPath);
  const voiceRoot = findDirAnyCase(path.dirname(espPath), `Sound/Voice/${pluginName}`);
  if (!voiceRoot) return map;

  let index: ReturnType<typeof loadInfoWemIndex> | null = null;
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(voiceRoot, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    let files: string[];
    try {
      files = fs.readdirSync(path.join(voiceRoot, dir.name));
    } catch {
      continue;
    }
    for (const file of files) {
      const match = /^([0-9A-Fa-f]{8})\.wem$/i.exec(file);
      if (!match) continue;
      index ??= loadInfoWemIndex(espPath);
      const line = lookupWemTakeLine(index, pluginName, match[1]!);
      if (!line) continue;
      let byVariant = map.get(line.lineKey);
      if (!byVariant) map.set(line.lineKey, (byVariant = new Map()));
      let folders = byVariant.get(line.variant);
      if (!folders) byVariant.set(line.variant, (folders = new Set()));
      folders.add(dir.name);
    }
  }

  logImport.debug(`WEM take folders: ${map.size} line(s) from ${voiceRoot}`);
  return map;
};

/** Turn a {@link buildVoiceFolderMap} result into display-ready speaker labels. */
const voiceSpeakerNamesFromFolders = (folderMap: Map<string, string>): Map<string, string> =>
  new Map([...folderMap].map(([formId, folder]) => [formId, cleanVoiceFolderName(folder)]));

export {
  buildNpcNameMap,
  buildSpeakerFormIdMap,
  buildVoiceFolderMap,
  buildWemTakeFolders,
  cleanVoiceFolderName,
  voiceSpeakerNamesFromFolders,
};
export type { TakeFoldersByLine };
