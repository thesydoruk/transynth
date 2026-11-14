/** Archive formats every game accepts, whatever it keeps inside them. */
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar'];

/**
 * `accept` attribute for the main Mods upload: the game's own file types plus
 * archives. Falls back to archives alone until the catalogue has loaded.
 */
export const acceptedModExtensions = (uploadExtensions: readonly string[] = []): string =>
  [...uploadExtensions, ...ARCHIVE_EXTENSIONS].join(',');

/** Mod import jobs that are still in-flight or not represented by a mod row. */
export const isActiveModImportJob = (
  job: { status: string; mod_id: number | null },
  importedModIds: ReadonlySet<number>,
): boolean => job.status !== 'completed' || job.mod_id == null || !importedModIds.has(job.mod_id);

/** How many things the Activity section would list. */
export const countActivity = (activity: {
  pendingUploads: unknown[];
  nexusDownloads: unknown[];
  appJobs: unknown[];
  llmJobs: unknown[];
  importJobs: unknown[];
}): number =>
  activity.pendingUploads.length +
  activity.nexusDownloads.length +
  activity.appJobs.length +
  activity.llmJobs.length +
  activity.importJobs.length;
