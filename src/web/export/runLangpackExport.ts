import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { resolveModStoredPath } from '../../modStorage';
import { getExportArchive, getModsByIds, setExportArchiveProgress } from '../data/queries';
import { exportLangpackZipToPath, type LangpackBatchMod } from './batchLangpack';
import {
  exportArchiveRelPath,
  exportArchiveZipPath,
  ensureExportArchiveDir,
} from './exportArchiveFiles';

export type LangpackExportJobParams = {
  archiveId: number;
  srcLang: string;
  targetLang: string;
};

export type LangpackExportRunResult = {
  status: 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  error: string | null;
  relPath?: string;
  byteSize?: number;
};

export const resolveLangpackExportTargets = async (
  db: Tx,
  modIds: number[],
): Promise<LangpackBatchMod[]> => {
  const rows = await getModsByIds(db, modIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const targets: LangpackBatchMod[] = [];
  for (const id of modIds) {
    const mod = byId.get(id);
    if (!mod?.abs_path) continue;
    targets.push({
      modId: id,
      modPath: resolveModStoredPath(mod.abs_path),
      game: (mod.game ?? 'fo4') as GameType,
    });
  }
  return targets;
};

export const runLangpackExportJob = async (
  db: Tx,
  params: LangpackExportJobParams,
  opts: {
    isCancelled: () => boolean;
    onProgress: (done: number, total: number) => void | Promise<void>;
  },
): Promise<LangpackExportRunResult> => {
  const archive = await getExportArchive(db, params.archiveId);
  if (!archive) {
    return { status: 'failed', done: 0, total: 0, error: 'Export archive row not found' };
  }

  const targets = await resolveLangpackExportTargets(db, archive.mod_ids);
  const total = targets.length;
  if (total === 0) {
    return { status: 'failed', done: 0, total: 0, error: 'No exportable mods in selection' };
  }

  await setExportArchiveProgress(db, archive.id, 0, total);
  await opts.onProgress(0, total);

  if (opts.isCancelled()) {
    return { status: 'cancelled', done: 0, total, error: null };
  }

  ensureExportArchiveDir(archive.id);
  const destPath = exportArchiveZipPath(archive.id, archive.file_name);
  const result = await exportLangpackZipToPath(
    db,
    targets,
    params.srcLang,
    params.targetLang,
    destPath,
    async (done, progressTotal) => {
      if (opts.isCancelled()) throw new Error('cancelled');
      await setExportArchiveProgress(db, archive.id, done, progressTotal);
      await opts.onProgress(done, progressTotal);
    },
  );

  if (opts.isCancelled()) {
    return { status: 'cancelled', done: total, total, error: null };
  }

  return {
    status: 'completed',
    done: total,
    total,
    error: null,
    relPath: exportArchiveRelPath(archive.id, archive.file_name),
    byteSize: result.byteSize,
  };
};
