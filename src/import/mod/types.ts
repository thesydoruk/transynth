import type { ModImportExtractManifest } from '../../modImport';
import type { GameType } from '../../types';
import type { VortexFolderInfo } from '../../utils/vortexFolder';

export interface ModImportJob {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string; // pending | extracting | in_progress | paused | failed | completed
  src_lang: string;
  tgt_lang: string;
  is_localized: number; // 0 | 1
  game: GameType;
  esp_path: string | null;
  extract_dir: string | null;
  archive_manifest: ModImportExtractManifest | null;
  nexus_mod_id: number | null;
  source_folder: string | null;
  nexus_mod_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Optional Vortex/Nexus hints collected during folder scans. */
export interface ModScanContext {
  nexusModId?: number;
  nexusModName?: string;
  sourceFolder?: string;
}

/** A mod artifact discovered in a directory listing. */
export interface ModFileCandidate {
  fileName: string;
  filePath: string;
  kind: 'plugin' | 'archive';
  vortex?: VortexFolderInfo;
}

/**
 * Progress callback invoked during long-running imports.
 *
 * @param imported - Number of records imported so far.
 * @param total - Total records expected for the job.
 */
export type ProgressCb = (imported: number, total: number) => void;
