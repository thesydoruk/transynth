import type { StringsType } from '../types/StringsType';
import { stringsTypeFromPath } from './stringsBuffer';

const STRINGS_FILE_RE = /^(.+)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i;

/** Parse `{stem}_{locale}.strings` style file names. */
export const parseStringsFileName = (
  fileName: string,
): { stem: string; locale: string; type: StringsType } | null => {
  const m = fileName.match(STRINGS_FILE_RE);
  if (!m) return null;
  return {
    stem: m[1]!,
    locale: m[2]!.toLowerCase(),
    type: stringsTypeFromPath(m[3]!),
  };
};

/**
 * Parse a STRINGS-family file name only when it is the plugin's own table.
 *
 * The engine loads `Strings/<pluginStem>_<locale>.(STRINGS|DLSTRINGS|ILSTRINGS)` and
 * nothing else; lstring ids are per plugin, so another plugin's tables in the same
 * folder must not be read. Stems compare case-insensitively, as on Windows.
 */
export const parsePluginStringsFileName = (
  fileName: string,
  pluginStem: string,
): { stem: string; locale: string; type: StringsType } | null => {
  const parsed = parseStringsFileName(fileName);
  return parsed && parsed.stem.toLowerCase() === pluginStem.toLowerCase() ? parsed : null;
};
