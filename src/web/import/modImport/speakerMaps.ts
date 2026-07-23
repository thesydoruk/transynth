import fs from 'node:fs';
import path from 'node:path';
import type { EspStringRow } from '../../../formats/esp';
import { logImport } from '../../../logging/loggers';

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
 * Build a speaker-name lookup from voice file directories.
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
 * @returns Map from lower-6-hex FormID → cleaned speaker display name.
 */
const buildVoiceSpeakerMap = (espPath: string): Map<string, string> => {
  const map = new Map<string, string>();
  const modDir = path.dirname(espPath);
  const pluginName = path.basename(espPath);
  const voiceRoot = path.join(modDir, 'Sound', 'Voice', pluginName);

  if (!fs.existsSync(voiceRoot)) return map;

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(voiceRoot, { withFileTypes: true });
  } catch {
    return map;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const speakerName = cleanVoiceFolderName(dir.name);

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
        map.set(lower6, speakerName);
      }
    }
  }

  logImport.debug(`Voice speaker map: ${map.size} entries from ${voiceRoot}`);
  return map;
};

export { buildNpcNameMap, buildSpeakerFormIdMap, buildVoiceSpeakerMap };
