import type { StringsType } from '../../../formats/types/StringsType';
import { stringsTypeFromPath } from '../../../formats/strings';

export const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);
export const STRINGS_DIR_NAMES = new Set(['strings']);
export const SKIP_DIRS = new Set(['.transynth-extracted', '.git', 'node_modules']);
export const STRINGS_FILE_RE = /^(.+)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i;

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
