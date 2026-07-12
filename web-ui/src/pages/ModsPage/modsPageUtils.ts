/** File extensions accepted by the unified mod workspace upload input. */
export const ACCEPTED_UPLOAD_EXTENSIONS = '.eet,.csv,.esp,.esm,.esl,.zip,.7z,.rar';

export type SupportedGameId = 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle';

export type UploadKind = 'eet' | 'csv' | 'mod';

/** Determines the import kind from a file extension. */
export const kindFromExt = (name: string): UploadKind | null => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.eet') return 'eet';
  if (ext === '.csv') return 'csv';
  if (['.esp', '.esm', '.esl', '.zip', '.7z', '.rar'].includes(ext)) return 'mod';
  return null;
};

export const isSupportedGameId = (value: string): value is SupportedGameId =>
  ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'].includes(value);

/** Mod import jobs that are still in-flight or not represented by a mod row. */
export const isActiveModImportJob = (
  job: { status: string; mod_id: number | null },
  importedModIds: ReadonlySet<number>,
): boolean => job.status !== 'completed' || job.mod_id == null || !importedModIds.has(job.mod_id);
