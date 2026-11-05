/**
 * One sync: hash the inventory (through the cache), plan with the server,
 * upload what changed, run import → carry (and TM when allowed), and tell the
 * server the current load order. Never more: LLM, verify, voice and export are
 * the user's buttons.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../../logger';
import { buildVortexInventory } from '../buildInventory';
import { discoverVortexExportOrder } from '../exportOrder';
import { vortexGroupLabel } from '../groupKey';
import { packVortexUnitZip, vortexUnitZipName } from '../packUnit';
import type { VortexExportOrder, VortexPlanUnit } from '../types';
import type { AgentApi } from './apiClient';
import { exportOrderSignature, unitsSignature } from './changeDetector';
import type { AgentConfig } from './config';
import { cachedFileHasher, type HashCache } from './hashCache';
import type { AgentState } from './state';

export type SyncOutcome =
  | { kind: 'unchanged' }
  | { kind: 'order-only'; groupId: number }
  | { kind: 'synced'; groupId: number; runId: number; uploaded: number; tmRunId: number | null };

type PlanResponse = {
  run: { id: number };
  group: { id: number; label: string };
  units: VortexPlanUnit[];
};

export type SyncContext = {
  config: AgentConfig;
  state: AgentState;
  cache: HashCache;
  api: AgentApi;
  /** Called while the cycle moves through its phases, for the heartbeat. */
  onPhase?: (phase: 'scanning' | 'uploading' | 'waiting-server') => void;
};

const readExportOrder = (config: AgentConfig): VortexExportOrder => {
  const found = discoverVortexExportOrder({
    game: config.game,
    stagingPath: config.stagingPath,
    pluginsTxt: config.pluginsTxt,
    vortexProfile: config.vortexProfile,
  });
  return {
    plugins: found.plugins,
    enabledPlugins: found.enabledPlugins,
    fileWinners: found.fileWinners,
    applyOrder: true,
  };
};

/** What the server will be told; the signatures decide whether to tell it. */
export const scanForSync = async (ctx: SyncContext) => {
  ctx.onPhase?.('scanning');
  const counters = { hits: 0, misses: 0 };
  const inventory = await buildVortexInventory({
    game: ctx.config.game,
    stagingPath: ctx.config.stagingPath,
    gameDir: ctx.config.gameDir,
    channel: ctx.config.channel,
    hashFile: cachedFileHasher(ctx.cache, undefined, counters),
  });
  const exportOrder = readExportOrder(ctx.config);
  return {
    inventory,
    exportOrder,
    unitsSig: unitsSignature(inventory.units),
    orderSig: exportOrderSignature(exportOrder),
    hashCounters: counters,
  };
};

export const runSyncCycle = async (ctx: SyncContext): Promise<SyncOutcome> => {
  const { config, state, api } = ctx;
  const scan = await scanForSync(ctx);
  log.info(
    `vortex-agent: ${scan.inventory.units.length} unit(s), hash cache ${scan.hashCounters.hits} hit / ${scan.hashCounters.misses} miss`,
  );
  const unitsChanged = scan.unitsSig !== state.signatures.units || state.lastRunId == null;
  const orderChanged = scan.orderSig !== state.signatures.order;

  if (!unitsChanged && !orderChanged) return { kind: 'unchanged' };

  if (!unitsChanged && state.groupId != null) {
    await api.postExportOrder(state.groupId, scan.exportOrder);
    state.signatures.order = scan.orderSig;
    return { kind: 'order-only', groupId: state.groupId };
  }

  const plan = await api.post<PlanResponse>('/api/vortex/sync/plan', {
    groupKey: scan.inventory.groupKey,
    label: vortexGroupLabel(scan.inventory.stagingPath, config.game),
    game: config.game,
    stagingPath: scan.inventory.stagingPath,
    gameDir: scan.inventory.gameDir,
    channel: config.channel,
    srcLang: config.srcLang,
    tgtLang: config.tgtLang,
    gameRelease: scan.inventory.gameRelease,
    startedBy: 'agent',
    units: scan.inventory.units.map(({ files: _files, ...unit }) => unit),
  });
  state.groupId = plan.group.id;
  const needed = new Set(
    plan.units.filter((u) => u.action === 'upload' || u.action === 'update').map((u) => u.unitId),
  );

  if (needed.size === 0 && state.lastRunId != null) {
    // Everything the server knows already; only the order may be new.
    await api.postExportOrder(plan.group.id, scan.exportOrder);
    state.signatures.units = scan.unitsSig;
    state.signatures.order = scan.orderSig;
    return { kind: 'order-only', groupId: plan.group.id };
  }

  ctx.onPhase?.('uploading');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-agent-'));
  let uploaded = 0;
  const rejected: string[] = [];
  try {
    for (const unit of scan.inventory.units) {
      if (!needed.has(unit.unitId)) continue;
      const zipPath = path.join(tmp, vortexUnitZipName(unit));
      await packVortexUnitZip(unit, zipPath);
      log.info(
        `vortex-agent: uploading ${unit.name} (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MiB)`,
      );
      try {
        await api.putUnitZip(plan.run.id, unit.unitId, zipPath);
        uploaded += 1;
      } catch (err) {
        // A unit the importer cannot register (a folder with nothing to
        // translate) must not stop the mods it can: note it and move on.
        const message = err instanceof Error ? err.message : String(err);
        if (!/\b5\d\d\b|Archive holds no/.test(message)) throw err;
        log.warn(`vortex-agent: ${unit.name} rejected by the server, skipping: ${message}`);
        rejected.push(unit.name);
      }
      fs.rmSync(zipPath, { force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (uploaded === 0 && rejected.length > 0 && state.lastRunId != null) {
    state.signatures.units = scan.unitsSig;
    state.signatures.order = scan.orderSig;
    return { kind: 'order-only', groupId: plan.group.id };
  }

  ctx.onPhase?.('waiting-server');
  await api.postExportOrder(plan.group.id, scan.exportOrder);
  const to = config.autoStages === 'import' ? 'import' : 'carry';
  const started = await api.startRange(plan.run.id, 'import', to, {
    exportOrder: scan.exportOrder,
  });
  if (!started.skipped) {
    await api.waitRun(plan.run.id, (run) =>
      log.info(
        `vortex-agent: run #${plan.run.id} ${run.status} ${run.current_stage ?? run.last_completed_stage ?? ''}`,
      ),
    );
  }

  let tmRunId: number | null = null;
  if (config.autoStages === 'tm') {
    const tm = await api.startStage(plan.group.id, 'tm', {
      channel: config.channel,
      startedBy: 'agent',
    });
    tmRunId = tm.runId;
    await api.waitRun(tm.runId, (run) =>
      log.info(`vortex-agent: TM run #${tm.runId} ${run.status}`),
    );
  }

  state.lastRunId = plan.run.id;
  state.signatures.units = scan.unitsSig;
  state.signatures.order = scan.orderSig;
  state.lastSyncAt = new Date().toISOString();
  return { kind: 'synced', groupId: plan.group.id, runId: plan.run.id, uploaded, tmRunId };
};
