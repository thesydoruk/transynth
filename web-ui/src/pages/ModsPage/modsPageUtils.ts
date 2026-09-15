/** Archive formats every game accepts, whatever it keeps inside them. */
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar'];

/**
 * `accept` attribute for the main Mods upload: the game's own file types plus
 * archives. Falls back to archives alone until the catalogue has loaded.
 */
export const acceptedModExtensions = (uploadExtensions: readonly string[] = []): string =>
  [...uploadExtensions, ...ARCHIVE_EXTENSIONS].join(',');

/** EET / CSV — behind Advanced import. */
export const ACCEPTED_ADVANCED_EXTENSIONS = '.eet,.csv';

export type UploadKind = 'eet' | 'csv' | 'mod';

/** Determines the import kind from a file extension. */
export const kindFromExt = (name: string): UploadKind | null => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.eet') return 'eet';
  if (ext === '.csv') return 'csv';
  if (['.esp', '.esm', '.esl', '.zip', '.7z', '.rar'].includes(ext)) return 'mod';
  return null;
};

/** Mod import jobs that are still in-flight or not represented by a mod row. */
export const isActiveModImportJob = (
  job: { status: string; mod_id: number | null },
  importedModIds: ReadonlySet<number>,
): boolean => job.status !== 'completed' || job.mod_id == null || !importedModIds.has(job.mod_id);

/** Local imports stay on the default list; Vortex jobs only inside their group. */
export const matchesVortexGroupView = (
  vortexGroupId: number | null | undefined,
  jobGroupId: number | null | undefined,
): boolean => {
  if (vortexGroupId == null) return jobGroupId == null;
  return jobGroupId === vortexGroupId;
};
