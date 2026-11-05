/** The `export` stage of a Vortex run: one langpack of the group's deployed mods. */
import type { Tx } from '../../../../src/db';
import { log } from '../../../../src/logger';
import { insertExportArchive } from '../../../../src/web/data/queries/exportArchives';
import {
  listCurrentGroupModIds,
  listVortexExportModRows,
  updateVortexSyncRun,
  type VortexSyncRunRow,
} from '../../../../src/vortex/db';
import { getGroupExportOrder } from '../../../../src/vortex/dbAgents';
import {
  filterVortexLangpackMods,
  isVortexExportOrder,
  orderVortexLangpackModIds,
} from '../../../../src/vortex/exportOrder';
import { readPluginMastersOf } from '../../../../src/vortex/pluginMasters';
import type { VortexExportOrder, VortexPlanUnit } from '../../../../src/vortex/types';
import { executeLangpackExport } from '../langpackExport/runJob';

export const planUnits = (run: VortexSyncRunRow): VortexPlanUnit[] => {
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

export const runExportStage = async (
  db: Tx,
  run: VortexSyncRunRow,
  opts: { isCancelled: () => boolean },
): Promise<void> => {
  const currentIds = await listCurrentGroupModIds(
    db,
    run.vortex_group_id,
    run.channel as 'all' | 'mods' | 'game',
  );
  if (currentIds.length === 0) throw new Error('No mods in Vortex group to export');
  // A run started without an order (an agent-planned import, a UI button)
  // exports with the load order the agent last reported for the group.
  const exportOrder = planExportOrder(run) ?? (await getGroupExportOrder(db, run.vortex_group_id));
  const units = planUnits(run);
  const rows = await listVortexExportModRows(db, currentIds);
  const refs = rows.map((row) => ({ ...row, pluginFileName: pluginNameForRow(row, units) }));
  const enabled = filterVortexLangpackMods(refs, exportOrder);
  if (enabled.length === 0) throw new Error('No enabled Vortex mods to export');
  if (exportOrder && enabled.length !== refs.length) {
    log.info(`Vortex export: ${enabled.length}/${refs.length} deployed Vortex mod(s)`);
  }
  const applyFileOrder = !exportOrder || exportOrder.applyOrder !== false;
  const modIds = orderVortexLangpackModIds(
    enabled,
    applyFileOrder ? exportOrder : null,
    readPluginMastersOf,
  );
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
};
