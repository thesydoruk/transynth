import type { StringsType } from '../../formats/types/StringsType';
import { stringsTypeFromPath } from '../../formats/strings';

export const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);
const STRINGS_DIR_NAMES = new Set(['strings']);
export const SKIP_DIRS = new Set(['.transynth-extracted', '.git', 'node_modules']);
const STRINGS_FILE_RE = /^(.+)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i;

export const isStringsDirName = (name: string): boolean =>
  STRINGS_DIR_NAMES.has(name.toLowerCase());

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
