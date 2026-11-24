/**
 * Source takes of a title that names them by WEM id (Starfield):
 * `Sound/Voice/<origin>/<VoiceType>/<8 hex>.wem`.
 *
 * The name does not say which line the take is, so each file is looked up in
 * the plugin's own INFO records (`infoWemIds.ts`) and comes back with the same
 * identity a FormID-named take has: origin, lower-6 of the INFO FormID, and
 * the response's position as the variant. A `.wem` no response of the plugin
 * names is not a take of any line and is left out.
 */
import path from 'node:path';
import { log } from '../logger';
import { walkVoiceTree, type VoiceFileEntry } from './discoverVoiceFiles';
import type { VoicePluginFormIds } from './infoResponseNumbers';
import { loadInfoWemIndex, lookupWemTakeLine } from './infoWemIds';

const WEM_TAKE_RE = /^([0-9A-Fa-f]{8})\.wem$/i;

/** Plugins already reported as having takes no INFO names, so a list call does not repeat it. */
const reportedUnmatched = new Set<string>();

const reportUnmatched = (pluginPath: string, matched: number, unmatched: number): void => {
  if (unmatched === 0) return;
  const summary = `${path.basename(pluginPath)}: ${unmatched} .wem file(s) match no INFO response (${matched} matched)`;
  if (matched > 0) {
    log.debug(`Voice takes ${summary}`);
    return;
  }
  // Nothing matched at all: the file names are not the plugin's TRDA WEM ids,
  // or the plugin is not the one these takes belong to.
  if (reportedUnmatched.has(pluginPath)) return;
  reportedUnmatched.add(pluginPath);
  log.warn(`Voice takes ${summary} — file names are expected to be the TRDA "WEM File" ids`);
};

export const discoverWemTakes = (
  packageDir: string,
  pluginRelPath: string,
  pluginFormIds?: VoicePluginFormIds,
): VoiceFileEntry[] => {
  const pluginPath = path.join(packageDir, ...pluginRelPath.replace(/\\/g, '/').split('/'));
  const index = loadInfoWemIndex(pluginPath, pluginFormIds);

  const byTake = new Map<string, VoiceFileEntry>();
  let unmatched = 0;
  walkVoiceTree(packageDir, pluginRelPath, (file) => {
    const match = file.name.match(WEM_TAKE_RE);
    if (!match) return;
    const line = lookupWemTakeLine(index, file.origin, match[1]!);
    if (!line) {
      unmatched += 1;
      return;
    }
    // One take per speaker folder and response, as for FormID-named takes.
    const dir = file.relPath.slice(0, file.relPath.lastIndexOf('/') + 1).toLowerCase();
    const key = `${dir}${line.lineKey}_${line.variant}`;
    if (byTake.has(key)) return;
    byTake.set(key, {
      relPath: file.relPath,
      absolutePath: file.absolutePath,
      fileName: file.name,
      lineKey: line.lineKey,
      variant: line.variant,
      ext: 'wem',
      originPlugin: file.origin,
    });
  });
  reportUnmatched(pluginPath, byTake.size, unmatched);

  return [...byTake.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
};
