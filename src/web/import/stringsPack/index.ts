/**
 * Import orphaned STRINGS/DLSTRINGS/ILSTRINGS packs (no sibling plugin).
 *
 * Orphan files are grouped by stem (plugin name). Each group is imported as one
 * mod with all locales merged. Rows are enriched from the matching plugin so
 * records keep FormID, EDID, and subrecord paths instead of bare lstring ids.
 */
export type {
  StringsPackFile,
  StringsPackCandidate,
  LstringEspIndex,
  StringsPackImportResult,
  StringsPackImportOptions,
} from './types';

export { parseStringsFileName } from './constants';
export { resolveStringsTypeForEspRow, buildLstringEspIndex, espRowToCsvRow } from './espIndex';
export { collectPluginStems, findPluginFile, resolvePluginPathForStem } from './pluginDiscovery';
export { discoverStringsPacks, groupStringsFilesByStem } from './discovery';
export { computeStringsPackHash, buildStringsPackModName, buildStringsPackRows } from './packRows';
export { importStringsPack } from './importStringsPack';
