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
import type { VideoManifest } from '../../video/manifest';
import { packVortexUnitZip, vortexUnitZipName } from '../packUnit';
import type {
  VortexExportOrder,
  VortexInventory,
  VortexInventoryFile,
  VortexPlanUnit,
} from '../types';
import { isUploadRejection, type AgentApi } from './apiClient';
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
  /** Called with every inventory the cycle takes, so the loop knows where the videos are. */
  onInventory?: (inventory: VortexInventory) => void;
  /** The machine's name, for the video manifests. */
  agentKey?: string;
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

/**
 * Start the group's TM run, or join the one already running: a run a previous
 * tick (or a manual start) left in progress is the same work, not an error.
 */
const startOrJoinTm = async (
  api: AgentApi,
  groupId: number,
  channel: AgentConfig['channel'],
): Promise<number> => {
  try {
    const tm = await api.startStage(groupId, 'tm', { channel, startedBy: 'agent' });
    return tm.runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const active = /^409 .*"runId":(\d+)/.exec(message);
    if (!active) throw err;
    log.info(`vortex-agent: joining run #${active[1]} already in progress`);
    return Number(active[1]);
  }
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
    videos: ctx.config.videos,
  });
  ctx.onInventory?.(inventory);
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
  // After a failed cycle the server's view of the group is unknown (a run that
  // died in carry leaves the newest mods untranslated), so plan again and run
  // the stages even when the inventory is the one last synced.
  const unitsChanged =
    scan.unitsSig !== state.signatures.units || state.lastRunId == null || state.resyncNeeded;
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

  if (needed.size === 0 && state.lastRunId != null && !state.resyncNeeded) {
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
  // A video goes up as its manifest: the hash the inventory already has and its size.
  const hashFile = cachedFileHasher(ctx.cache);
  const describe = async (file: VortexInventoryFile): Promise<VideoManifest> => ({
    fileName: path.basename(file.relPath),
    byteSize: fs.statSync(file.absPath).size,
    sha1: await hashFile(file.absPath),
    ...(ctx.agentKey ? { agentKey: ctx.agentKey } : {}),
  });
  try {
    for (const unit of scan.inventory.units) {
      if (!needed.has(unit.unitId)) continue;
      const zipPath = path.join(tmp, vortexUnitZipName(unit));
      await packVortexUnitZip(unit, zipPath, { describeVideo: describe });
      log.info(
        `vortex-agent: uploading ${unit.name} (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MiB)`,
      );
      try {
        await api.putUnitZip(plan.run.id, unit.unitId, zipPath);
        uploaded += 1;
      } catch (err) {
        // A unit the importer cannot register (a folder with nothing to
        // translate) must not stop the mods it can: note it and move on.
        // Anything else — a lost connection, an upload nobody registered — fails
        // the cycle, which leaves the signatures unsaved so the next one retries.
        const message = err instanceof Error ? err.message : String(err);
        if (!isUploadRejection(message)) throw err;
        log.warn(`vortex-agent: ${unit.name} rejected by the server, skipping: ${message}`);
        rejected.push(unit.name);
      }
      fs.rmSync(zipPath, { force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (uploaded === 0 && rejected.length > 0 && state.lastRunId != null && !state.resyncNeeded) {
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
    tmRunId = await startOrJoinTm(api, plan.group.id, config.channel);
    await api.waitRun(tmRunId, (run) => log.info(`vortex-agent: TM run #${tmRunId} ${run.status}`));
  }

  state.lastRunId = plan.run.id;
  state.signatures.units = scan.unitsSig;
  state.signatures.order = scan.orderSig;
  state.lastSyncAt = new Date().toISOString();
  state.resyncNeeded = false;
  return { kind: 'synced', groupId: plan.group.id, runId: plan.run.id, uploaded, tmRunId };
};
