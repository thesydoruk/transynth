import type { ZipPackEntry } from './exportTypes';

/** Flatten zip paths so Vortex sees one Data tree, not a folder per mod. */
export const normalizeLangpackZipPath = (raw: string): string => {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return cleaned.replace(/^data\//i, '');
};

/** Merge entries onto shared game paths; later mods win on case-insensitive collisions. */
export const mergeLangpackEntries = (entries: ZipPackEntry[]): ZipPackEntry[] => {
  const byKey = new Map<string, ZipPackEntry>();
  for (const entry of entries) {
    const name = normalizeLangpackZipPath(entry.name);
    if (!name) continue;
    byKey.set(name.toLowerCase(), { ...entry, name });
  }
  return [...byKey.values()];
};
