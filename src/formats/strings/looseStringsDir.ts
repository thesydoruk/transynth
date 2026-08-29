import fs from 'node:fs';
import path from 'node:path';

const isStringsDirName = (name: string): boolean => name.toLowerCase() === 'strings';

/**
 * Loose Bethesda strings folder next to a plugin.
 *
 * Windows installs use `Strings\`; Linux extracts and case-sensitive FS often
 * keep the archive entry name as `STRINGS\`.
 */
export const resolveLooseStringsDir = (modDir: string): string | null => {
  try {
    for (const entry of fs.readdirSync(modDir, { withFileTypes: true })) {
      if (entry.isDirectory() && isStringsDirName(entry.name)) {
        return path.join(modDir, entry.name);
      }
    }
  } catch {
    /* mod dir missing or unreadable */
  }
  return null;
};

export const resolveLooseStringsDirForPlugin = (pluginPath: string): string | null =>
  resolveLooseStringsDir(path.dirname(pluginPath));
