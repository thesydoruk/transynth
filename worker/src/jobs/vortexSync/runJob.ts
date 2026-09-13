import type { Tx } from '../../../../src/db';
import { carryOverTranslations } from '../../../../src/web/data/queries/importDiff';
import { reuseSynthesizedVoice } from '../../../../src/voice/reuseSynthesizedVoice';
import { invalidateVoiceListContext } from '../../../../src/web/voice/preview/voiceListContext';
import { insertExportArchive } from '../../../../src/web/data/queries/exportArchives';
import { executeLangpackExport } from '../langpackExport/runJob';
import { runModImport } from '../import/mod/runImport';
import { getModImportJob } from '../../../../src/import/mod/jobs';
import { runLlmTranslateJob } from '../translate/runJob';
import { log } from '../../../../src/logger';
import {
  findPreviousVortexMod,
  getVortexSyncRun,
  listCurrentGroupModIds,
  listVortexExportModRows,
  markCurrentVortexMods,
  updateVortexSyncRun,
  upsertCurrentGameRelease,
  type VortexSyncRunRow,
} from '../../../../src/vortex/db';
import {
  filterVortexLangpackMods,
  isVortexExportOrder,
  orderVortexLangpackModIds,
} from '../../../../src/vortex/exportOrder';
import type { ServerVortexStage } from '../../../../src/vortex/stages';
import type { VortexExportOrder, VortexPlanUnit } from '../../../../src/vortex/types';
import type { JobResult } from '../../types';

export type VortexSyncJobParams = {
  runId: number;
  from: ServerVortexStage;
  to: ServerVortexStage;
};

const STAGE_ORDER: ServerVortexStage[] = ['import', 'carry', 'llm', 'export'];

const sliceStages = (from: ServerVortexStage, to: ServerVortexStage): ServerVortexStage[] => {
  const start = STAGE_ORDER.indexOf(from);
  const end = STAGE_ORDER.indexOf(to);
  if (start < 0 || end < 0 || start > end) {
    throw new Error(`Invalid server stage range: ${from}..${to}`);
  }
  return STAGE_ORDER.slice(start, end + 1);
};

const planUnits = (run: VortexSyncRunRow): VortexPlanUnit[] => {
  const raw = run.plan_json as { units?: VortexPlanUnit[] } | null;
  return raw?.units ?? [];
};

const planExportOrder = (run: VortexSyncRunRow): VortexExportOrder | null => {
  const raw = run.plan_json as { exportOrder?: unknown } | null;
  return isVortexExportOrder(raw?.exportOrder) ? raw.exportOrder : null;
};

const pluginNameForRow = (
  row: { name: string; abs_path: string | null; source_folder: string | null },
  units: VortexPlanUnit[],
): string | null => {
  const byFolder = row.source_folder
    ? units.find((unit) => unit.sourceFolder === row.source_folder)
    : undefined;
  if (byFolder?.pluginFileName) return byFolder.pluginFileName;
  return units.find((unit) => unit.name === row.name)?.pluginFileName ?? null;
};

export const runVortexSyncJob = async (
  db: Tx,
  params: VortexSyncJobParams,
  opts: { jobId: number; isCancelled: () => boolean },
): Promise<JobResult> => {
  const run = await getVortexSyncRun(db, params.runId);
  if (!run) throw new Error(`Vortex sync run ${params.runId} not found`);

  await updateVortexSyncRun(db, run.id, { status: 'running', job_id: opts.jobId });
  const stages = sliceStages(params.from, params.to);
  const units = planUnits(run);
  const importedModIds: number[] = [];

  const touch = async (stage: ServerVortexStage, modId?: number | null) => {
    await updateVortexSyncRun(db, run.id, {
      current_stage: stage,
      current_mod_id: modId ?? null,
    });
  };

  try {
    for (const stage of stages) {
      if (opts.isCancelled()) {
        await updateVortexSyncRun(db, run.id, { status: 'cancelled' });
        return { status: 'cancelled', error: null, done: 0, total: stages.length };
      }
      await touch(stage);

      if (stage === 'import') {
        for (const unit of units) {
          if (unit.action === 'skip' && unit.existingModId) {
            importedModIds.push(unit.existingModId);
            continue;
          }
          if (!unit.existingJobId) continue;
          const job = await getModImportJob(db, unit.existingJobId);
          if (!job) continue;
          if (job.status === 'completed' && job.mod_id) {
            importedModIds.push(job.mod_id);
            continue;
          }
          log.info(`Vortex sync: importing ${unit.name} (job #${job.id})`);
          const result = await runModImport(db, job);
          if (result.mod_id) importedModIds.push(result.mod_id);
        }
        const hint = (
          run.plan_json as { gameRelease?: { versionLabel: string; releaseHash: string } }
        )?.gameRelease;
        if (hint?.releaseHash) {
          const releaseId = await upsertCurrentGameRelease(db, run.vortex_group_id, hint);
          if (releaseId) {
            await db.query(
              `UPDATE mods SET game_release_id = $1,
                     version_label = COALESCE(NULLIF(version_label, ''), $4)
               WHERE vortex_group_id = $2 AND channel = 'game' AND id = ANY($3::int[])`,
              [releaseId, run.vortex_group_id, importedModIds, hint.versionLabel],
            );
          }
        }
        await markCurrentVortexMods(db, run.vortex_group_id, importedModIds);
      }

      const targetIds =
        importedModIds.length > 0
          ? importedModIds
          : await listCurrentGroupModIds(
              db,
              run.vortex_group_id,
              run.channel as 'all' | 'mods' | 'game',
            );

      if (stage === 'carry') {
        for (const modId of targetIds) {
          const { rows } = await db.query<{ name: string; nexus_mod_id: number | null }>(
            `SELECT name, nexus_mod_id FROM mods WHERE id = $1`,
            [modId],
          );
          const mod = rows[0];
          if (!mod) continue;
          const prev = await findPreviousVortexMod(db, {
            groupId: run.vortex_group_id,
            newModId: modId,
            nexusModId: mod.nexus_mod_id,
            name: mod.name,
          });
          if (prev) {
            await touch('carry', modId);
            await carryOverTranslations(db, modId, prev, run.tgt_lang, run.src_lang);
          }
          await touch('carry', modId);
          const voice = await reuseSynthesizedVoice(db, modId, run.tgt_lang);
          if (voice.copied > 0) {
            invalidateVoiceListContext(modId);
            log.info(`Vortex sync: copied ${voice.copied} synthesized take(s) into mod ${modId}`);
          }
        }
      }

      if (stage === 'llm') {
        const abort = new AbortController();
        for (const modId of targetIds) {
          await touch('llm', modId);
          try {
            await runLlmTranslateJob(
              db,
              {
                jobId: opts.jobId,
                modId,
                srcLang: run.src_lang,
                targetLang: run.tgt_lang,
                signal: abort.signal,
                isCancelled: opts.isCancelled,
              },
              () => undefined,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes('No untranslated strings')) throw err;
            log.info(`Vortex sync: skip LLM for mod ${modId} (nothing to translate)`);
          }
        }
      }

      if (stage === 'export') {
        const currentIds = await listCurrentGroupModIds(
          db,
          run.vortex_group_id,
          run.channel as 'all' | 'mods' | 'game',
        );
        if (currentIds.length === 0) throw new Error('No mods in Vortex group to export');
        const exportOrder = planExportOrder(run);
        const units = planUnits(run);
        const rows = await listVortexExportModRows(db, currentIds);
        const refs = rows.map((row) => ({
          ...row,
          pluginFileName: pluginNameForRow(row, units),
        }));
        const enabled = filterVortexLangpackMods(refs, exportOrder);
        if (enabled.length === 0) throw new Error('No enabled Vortex mods to export');
        if (exportOrder && enabled.length !== refs.length) {
          log.info(`Vortex export: ${enabled.length}/${refs.length} deployed Vortex mod(s)`);
        }
        const applyFileOrder = !exportOrder || exportOrder.applyOrder !== false;
        const modIds = orderVortexLangpackModIds(enabled, applyFileOrder ? exportOrder : null);
        const sourceFolders = Object.fromEntries(enabled.map((row) => [row.id, row.source_folder]));
        if (exportOrder) {
          log.info(
            `Vortex export: ${exportOrder.plugins.length} plugin(s) in load order, ${exportOrder.fileWinners.length} file winner(s)`,
          );
        }
        const archive = await insertExportArchive(db, {
          game: run.game,
          srcLang: run.src_lang,
          tgtLang: run.tgt_lang,
          label: `vortex-${run.vortex_group_id}`,
          fileName: `${run.game}_${run.tgt_lang}_langpack.zip`,
          modIds,
          totalCount: modIds.length,
        });
        const result = await executeLangpackExport(
          db,
          {
            archiveId: archive.id,
            srcLang: run.src_lang,
            targetLang: run.tgt_lang,
            fileWinners: applyFileOrder ? exportOrder?.fileWinners : undefined,
            sourceFolders,
          },
          { isCancelled: opts.isCancelled, onProgress: () => undefined },
        );
        await updateVortexSyncRun(db, run.id, { export_archive_id: archive.id });
        if (result.status !== 'completed') {
          throw new Error(result.error ?? `Export ${result.status}`);
        }
      }

      await updateVortexSyncRun(db, run.id, { last_completed_stage: stage });
    }

    await updateVortexSyncRun(db, run.id, { status: 'completed', current_stage: null });
    return { status: 'completed', error: null, done: stages.length, total: stages.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateVortexSyncRun(db, run.id, { status: 'failed', error: message });
    throw err;
  }
};
