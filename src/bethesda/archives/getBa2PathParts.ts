export interface Ba2PathParts {
  dir: string;
  stem: string;
  ext: string;
}

/**
 * Split an archive-relative path into directory, stem, and extension.
 *
 * @param fullPath - Archive-relative path such as "Strings\\MyMod_uk.STRINGS".
 * @returns Normalized BA2 path components for hashing and extension fields.
 */
export const getBa2PathParts = (fullPath: string): Ba2PathParts => {
  const normalized = fullPath.toLowerCase().replace(/\//g, '\\');
  const lastSep = normalized.lastIndexOf('\\');
  const dir = lastSep >= 0 ? normalized.substring(0, lastSep) : '';
  const filename = lastSep >= 0 ? normalized.substring(lastSep + 1) : normalized;
  const dotIdx = filename.lastIndexOf('.');
  const stem = dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
  const ext = dotIdx >= 0 ? filename.substring(dotIdx + 1) : '';

  return { dir, stem, ext };
};
