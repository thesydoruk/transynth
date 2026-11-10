#!/usr/bin/env tsx
/**
 * Sync a Vortex staging tree + game Data into an isolated Transynth group.
 *
 *   npm run vortex:sync -- --staging "D:\\Vortex Mods\\fallout4" --game-dir "D:\\Games\\Fallout4"
 *
 * EXPERIMENTAL. It reads a real staging folder and a real game install; the
 * resident agent (`npm run vortex:agent`) is the supported way to keep a
 * staging folder in sync, this CLI is for one-off stage runs.
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { DEFAULT_GAME_ID, allGamePlugins } from '../src/games/registry';
import { log } from '../src/logger';
import type { GameId } from '../src/types';
import { createAgentApi } from '../src/vortex/agent/apiClient';
import {
  buildVortexInventory,
  discoverVortexExportOrder,
  packVortexUnitZip,
  vortexGroupKey,
  vortexGroupLabel,
  vortexUnitZipName,
} from '../src/vortex';
import {
  isVortexChannel,
  needsVortexFileInventory,
  resolveStageRange,
  splitVortexPipeline,
  type ServerVortexStage,
  type VortexFanOutStage,
} from '../src/vortex/stages';

/**
 * Only games a mod manager actually deploys.
 *
 * A plugin says so by declaring a `deployment` adapter; one that does not —
 * Disco Elysium, or anything else installed by hand — never reaches Vortex,
 * and dropping off this list is the plugin's own doing, not an edit here.
 */
const GAME_CHOICES = allGamePlugins()
  .filter((plugin) => plugin.deployment)
  .map((plugin) => plugin.id);

const argv = await yargs(hideBin(process.argv))
  .scriptName('vortex:sync')
  .option('staging', { type: 'string', demandOption: true, describe: 'Vortex staging folder' })
  .option('game-dir', { type: 'string', describe: 'Game install folder (plan/upload/import)' })
  .option('api', {
    type: 'string',
    default: process.env.TRANSYNTH_API_URL || 'http://127.0.0.1:3000',
  })
  .option('game', { type: 'string', default: 'fo4', choices: [...GAME_CHOICES] })
  .option('src-lang', { type: 'string', default: CONFIG.defaultSrcLang })
  .option('tgt-lang', { type: 'string', default: CONFIG.defaultTgtLang })
  .option('token', { type: 'string', default: process.env.TRANSYNTH_CLI_TOKEN || '' })
  .option('stage', { type: 'string', describe: 'Run a single stage' })
  .option('from', { type: 'string', describe: 'First stage (inclusive)' })
  .option('to', { type: 'string', describe: 'Last stage (inclusive)' })
  .option('channel', { type: 'string', default: 'all', choices: ['all', 'mods', 'game'] })
  .option('dry-run', { type: 'boolean', default: false })
  .option('out', { type: 'string', describe: 'Write langpack ZIP here' })
  .option('apply-order', {
    type: 'boolean',
    default: true,
    describe: 'Apply Vortex load order and file overwrite winners when exporting the langpack',
  })
  .option('plugins-txt', {
    type: 'string',
    describe: 'plugins.txt, loadorder.txt, or a folder that contains them',
  })
  .option('vortex-profile', { type: 'string', describe: 'Vortex profile folder' })
  .help()
  .parse();

const api = createAgentApi({ api: String(argv.api), token: argv.token || CONFIG.cliToken });
const apiJson = api.json;
const putUnitZip = api.putUnitZip;

const isDeployableGame = (value: string): value is GameId =>
  (GAME_CHOICES as readonly string[]).includes(value);

const stages = resolveStageRange(argv.from, argv.to, argv.stage);
const channel = isVortexChannel(argv.channel) ? argv.channel : 'all';
const game = isDeployableGame(argv.game) ? argv.game : DEFAULT_GAME_ID;

/**
 * Said out loud on every run.
 *
 * The command touches a real Vortex staging folder and a real game install, so
 * whoever runs it should know how early this is before it does, not after.
 */
const EXPERIMENTAL_NOTICE =
  'Vortex sync is EXPERIMENTAL and at a very early stage. It reads your staging ' +
  'folder and game install. Try --dry-run before a real run; the resident agent ' +
  '(npm run vortex:agent) is the supported way to keep a staging folder in sync.';

log.warn(EXPERIMENTAL_NOTICE);
log.info(`Vortex sync stages=${stages.join('→')} channel=${channel} game=${game}`);

const needInventory = needsVortexFileInventory(stages);
if (needInventory && !argv['game-dir']) {
  throw new Error('--game-dir is required for plan/upload/import');
}

type PlanResponse = {
  run: { id: number };
  group: { id: number; label: string };
  units: Array<{
    unitId: string;
    action: string;
    name: string;
    existingJobId: number | null;
  }>;
};
type GroupRef = { id: number; label: string };

const { beforeTm, fanOut, wantsExport } = splitVortexPipeline(stages);

let inventory: Awaited<ReturnType<typeof buildVortexInventory>> | null = null;
let plan: PlanResponse | null = null;
let group: GroupRef | null = null;

if (needInventory) {
  inventory = await buildVortexInventory({
    game,
    stagingPath: argv.staging,
    gameDir: argv['game-dir'] as string,
    channel,
  });

  log.info(
    `Inventory: ${inventory.units.length} unit(s), game release ${inventory.gameRelease.versionLabel} (${inventory.gameRelease.releaseHash.slice(0, 12)})`,
  );
  for (const unit of inventory.units) {
    log.info(
      `  [${unit.channel}] ${unit.name}  ${unit.contentHash.slice(0, 12)}  ${unit.files.length} file(s)`,
    );
  }

  if (argv['dry-run']) {
    log.info('Dry run — local inventory only, no API writes.');
    process.exit(0);
  }

  plan = await apiJson<PlanResponse>('/api/vortex/sync/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupKey: inventory.groupKey,
      label: vortexGroupLabel(inventory.stagingPath, inventory.game),
      game: inventory.game,
      stagingPath: inventory.stagingPath,
      gameDir: inventory.gameDir,
      channel,
      srcLang: argv['src-lang'],
      tgtLang: argv['tgt-lang'],
      gameRelease: inventory.gameRelease,
      units: inventory.units.map((unit) => ({
        unitId: unit.unitId,
        channel: unit.channel,
        name: unit.name,
        pluginStem: unit.pluginStem,
        pluginFileName: unit.pluginFileName,
        ...(unit.plugins ? { plugins: unit.plugins } : {}),
        sourceFolder: unit.sourceFolder,
        nexusModId: unit.nexusModId,
        nexusModName: unit.nexusModName,
        contentHash: unit.contentHash,
      })),
    }),
  });
  group = plan.group;
  log.info(`Plan run #${plan.run.id} group=${plan.group.label}`);
  for (const unit of plan.units) {
    log.info(`  ${unit.action.padEnd(7)} ${unit.name}`);
  }
} else {
  const groupKey = vortexGroupKey(game, argv.staging);
  const found = await apiJson<{ group: GroupRef }>(
    `/api/vortex/groups/by-key?game=${encodeURIComponent(game)}&key=${encodeURIComponent(groupKey)}`,
  );
  group = found.group;
  log.info(`Group #${group.id} ${group.label} (no file hash — TM/LLM reuse existing mods)`);
}

if (argv['dry-run'] && !needInventory) {
  const listed = await apiJson<{ mods: Array<{ id: number; name: string }> }>(
    `/api/vortex/groups/${group.id}/mods?channel=${encodeURIComponent(channel)}`,
  );
  log.info(`Dry run — ${listed.mods.length} mod(s) in group, no jobs started.`);
  for (const mod of listed.mods) log.info(`  #${mod.id} ${mod.name}`);
  process.exit(0);
}

if (stages.includes('upload')) {
  if (!inventory || !plan) throw new Error('Upload needs a hashed inventory and plan');
  const needed = new Set(
    plan.units
      .filter((unit) => unit.action === 'upload' || unit.action === 'update')
      .map((u) => u.unitId),
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-sync-'));
  try {
    for (const unit of inventory.units) {
      if (!needed.has(unit.unitId)) continue;
      const zipPath = path.join(tmp, vortexUnitZipName(unit));
      log.info(`Packing ${unit.name} (${unit.files.length} file(s))…`);
      await packVortexUnitZip(unit, zipPath);
      const bytes = fs.statSync(zipPath).size;
      log.info(`Uploading ${unit.name} (${(bytes / 1024 / 1024).toFixed(1)} MiB)…`);
      await putUnitZip(plan.run.id, unit.unitId, zipPath);
      log.info(`Uploaded ${unit.name}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const ensureRunId = async (): Promise<number> => {
  if (plan) return plan.run.id;
  if (!group) throw new Error('No Vortex group');
  const latest = await apiJson<{ run: { id: number } | null }>(
    `/api/vortex/groups/${group.id}/latest-run`,
  );
  if (!latest.run) {
    throw new Error('No Vortex sync run for this group — import first');
  }
  plan = {
    run: latest.run,
    group,
    units: [],
  };
  return latest.run.id;
};

const waitVortexRun = async (runId: number): Promise<void> => {
  await api.waitRun(runId, (run) =>
    log.info(
      `  status=${run.status} stage=${run.current_stage ?? run.last_completed_stage ?? '?'}`,
    ),
  );
};

const startWorkerStages = async (
  workerStages: ServerVortexStage[],
  extra: Record<string, unknown> = {},
): Promise<void> => {
  if (workerStages.length === 0) return;
  const runId = await ensureRunId();
  const start = await apiJson<{
    jobId?: number;
    from?: string;
    to?: string;
    skipped?: boolean;
  }>(`/api/vortex/sync/${runId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: workerStages[0],
      to: workerStages[workerStages.length - 1],
      ...extra,
    }),
  });
  if (start.skipped) {
    log.info(
      `Vortex-sync skipped (${start.from ?? workerStages[0]}→${start.to ?? workerStages.at(-1)})`,
    );
    return;
  }
  log.info(`Started vortex-sync job #${start.jobId} ${start.from}→${start.to}`);
  await waitVortexRun(runId);
};

/** A fan-out stage: one run per stage, the server enqueues the per-mod jobs. */
const runFanOutStage = async (stage: VortexFanOutStage): Promise<void> => {
  if (!group) throw new Error('No Vortex group');
  const started = await apiJson<{ runId: number; jobId: number }>(
    `/api/vortex/groups/${group.id}/stage/${stage}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, startedBy: 'agent' }),
    },
  );
  log.info(`Started ${stage} run #${started.runId} (job #${started.jobId})`);
  await waitVortexRun(started.runId);
};

const exportStartBody = async (): Promise<Record<string, unknown>> => {
  if (!stages.includes('export')) return {};
  const found = discoverVortexExportOrder({
    game,
    stagingPath: argv.staging,
    pluginsTxt: argv['plugins-txt'],
    vortexProfile: argv['vortex-profile'],
  });
  log.info(
    `Vortex order: ${found.plugins.length} plugin(s) from ${found.loadOrderSource ?? 'official masters'}, ${found.enabledPlugins?.length ?? 0} enabled, ${found.fileWinners.length} file winner(s) from ${found.deploymentSource ?? 'none'}`,
  );
  if (
    found.fileWinners.length === 0 &&
    found.plugins.length === 0 &&
    (found.enabledPlugins?.length ?? 0) === 0
  ) {
    log.info('Vortex order: nothing to apply, langpack merge stays alphabetical');
    return {};
  }
  return {
    exportOrder: {
      plugins: found.plugins,
      enabledPlugins: found.enabledPlugins,
      fileWinners: found.fileWinners,
      applyOrder: argv['apply-order'],
    },
  };
};

const exportOrderBody = await exportStartBody();
await startWorkerStages(beforeTm, exportOrderBody);
for (const stage of fanOut) await runFanOutStage(stage);
if (wantsExport) await startWorkerStages(['export'], exportOrderBody);

// The langpack is never unpacked into staging behind Vortex's back any more; the
// agent drops it into Vortex's downloads folder, and `--out` saves a copy here.
if (argv.out) {
  const runId = await ensureRunId();
  const destBytes = await api.downloadLangpack(runId, argv.out);
  log.info(`Langpack saved: ${argv.out} (${(destBytes / 1024 / 1024).toFixed(1)} MiB)`);
}

log.info('Vortex sync finished.');
