import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { CONFIG } from '../../config';
import { startBackgroundJob } from '../../../worker/src/api/startBackgroundJob';
import {
  findRunningExportArchive,
  getModsByIds,
  insertExportArchive,
  setExportArchiveJobId,
  type ExportArchiveRow,
} from '../data/queries';
import { resolveLangpackExportTargets } from '../export/runLangpackExport';

export type StartLangpackExportInput = {
  modIds: number[];
  srcLang?: string;
  targetLang?: string;
};

export type StartLangpackExportResult =
  | { ok: true; archive: ExportArchiveRow; jobId: number }
  | { ok: false; status: 400 | 409; error: string };

const parseModIdList = (modIds: number[]): { modIds: number[] } | { error: string } => {
  if (!Array.isArray(modIds) || modIds.length === 0) {
    return { error: 'modIds must be a non-empty array' };
  }
  if (modIds.length > 100) {
    return { error: 'Too many mods in one batch (max 100)' };
  }
  if (!modIds.every((id) => Number.isInteger(id) && id > 0)) {
    return { error: 'Invalid mod id in modIds' };
  }
  return { modIds };
};

export const startLangpackExport = async (
  db: Tx,
  input: StartLangpackExportInput,
): Promise<StartLangpackExportResult> => {
  const parsed = parseModIdList(input.modIds);
  if ('error' in parsed) return { ok: false, status: 400, error: parsed.error };

  const running = await findRunningExportArchive(db);
  if (running) {
    return {
      ok: false,
      status: 409,
      error: `An export is already running (${running.label})`,
    };
  }

  const srcLang = input.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = input.targetLang ?? CONFIG.defaultTgtLang;
  const targets = await resolveLangpackExportTargets(db, parsed.modIds);
  if (targets.length === 0) {
    return { ok: false, status: 400, error: 'No exportable mods in selection' };
  }

  const game = (targets[0]?.game ?? 'fo4') as GameType;
  const fileName = `${game}_${targetLang}_langpack.zip`;
  const mods = await getModsByIds(
    db,
    targets.map((t) => t.modId),
  );
  const nameById = new Map(mods.map((mod) => [mod.id, mod.name]));
  const names = targets.map((t) => nameById.get(t.modId) ?? String(t.modId));
  const label = names.length === 1 ? names[0]! : `${names[0] ?? fileName} +${names.length - 1}`;

  const archive = await insertExportArchive(db, {
    game,
    srcLang,
    tgtLang: targetLang,
    label,
    fileName,
    modIds: targets.map((t) => t.modId),
    totalCount: targets.length,
  });

  const jobId = await startBackgroundJob(
    {
      kind: 'langpack-export',
      modId: targets.length === 1 ? targets[0]!.modId : null,
      params: { archiveId: archive.id, srcLang, targetLang },
    },
    { archiveId: archive.id },
  );
  await setExportArchiveJobId(db, archive.id, jobId);
  return { ok: true, archive: { ...archive, job_id: jobId }, jobId };
};
