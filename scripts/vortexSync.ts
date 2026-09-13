#!/usr/bin/env tsx
/**
 * Sync a Vortex staging tree + game Data into an isolated Transynth group.
 *
 *   npm run vortex:sync -- --staging "D:\\Vortex Mods\\fallout4" --game-dir "D:\\Games\\Fallout4"
 */
import '../src/loadEnv';
import fs from 'node:fs';
import { openAsBlob } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { log } from '../src/logger';
import { extractArchive } from '../src/tools/archiveUtils';
import type { GameType } from '../src/types';
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
} from '../src/vortex/stages';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

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
  .option('install-staging', { type: 'boolean', default: false })
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

const headers = (): Record<string, string> => {
  const token = argv.token || CONFIG.cliToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const apiUrl = (suffix: string): string => `${String(argv.api).replace(/\/+$/, '')}${suffix}`;

const apiJson = async <T>(suffix: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(apiUrl(suffix), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...headers(),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${suffix}: ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** File-backed multipart — do not read the zip into RAM (official Voices/Main are multi-GB). */
const uploadAgent = new Agent({ headersTimeout: 60 * 60 * 1000, bodyTimeout: 0 });

const putUnitZip = async (runId: number, unitId: string, zipPath: string): Promise<void> => {
  const blob = await openAsBlob(zipPath, { type: 'application/zip' });
  const form = new FormData();
  form.append('file', blob, path.basename(zipPath));
  const res = await undiciFetch(
    apiUrl(`/api/vortex/sync/${runId}/packs/${encodeURIComponent(unitId)}`),
    {
      method: 'PUT',
      headers: headers(),
      body: form,
      dispatcher: uploadAgent,
    },
  );
  if (!res.ok) throw new Error(`Upload ${unitId} failed: ${await res.text()}`);
};

const isGameType = (value: string): value is GameType =>
  (GAME_CHOICES as readonly string[]).includes(value);

const stages = resolveStageRange(argv.from, argv.to, argv.stage);
const channel = isVortexChannel(argv.channel) ? argv.channel : 'all';
const game = isGameType(argv.game) ? argv.game : 'fo4';

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
type TmJobStatus = {
  jobId: number;
  status: string;
  done: number;
  total: number;
  applied: number;
  skipped: number;
  error: string | null;
};

const { beforeTm, wantsTm, afterTm } = splitVortexPipeline(stages);

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
  for (;;) {
    const run = await apiJson<{
      status: string;
      current_stage: string | null;
      last_completed_stage: string | null;
      error: string | null;
    }>(`/api/vortex/sync/${runId}`);
    log.info(
      `  status=${run.status} stage=${run.current_stage ?? run.last_completed_stage ?? '?'}`,
    );
    if (run.status === 'completed') return;
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.error || run.status);
    }
    await sleep(3000);
  }
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

const waitTmApply = async (modName: string, jobId: number): Promise<TmJobStatus> => {
  for (;;) {
    const job = await apiJson<TmJobStatus>(`/api/tm-apply/${jobId}`);
    log.info(
      `  TM ${modName} job #${jobId} status=${job.status} ${job.done}/${job.total} applied=${job.applied}`,
    );
    if (job.status === 'completed') return job;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(job.error || `TM ${modName} ${job.status}`);
    }
    await sleep(3000);
  }
};

const runTmApplyForGroup = async (): Promise<void> => {
  if (!group) throw new Error('No Vortex group');
  const listed = await apiJson<{ mods: Array<{ id: number; name: string }> }>(
    `/api/vortex/groups/${group.id}/mods?channel=${encodeURIComponent(channel)}`,
  );
  if (listed.mods.length === 0) throw new Error('No mods in Vortex group for TM');
  log.info(`TM apply: ${listed.mods.length} mod(s) as tm-apply jobs (same as editor)`);
  for (const mod of listed.mods) {
    const started = await apiJson<{ jobId: number; modId: number; name: string }>(
      `/api/mods/${mod.id}/tm-apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srcLang: argv['src-lang'],
          targetLang: argv['tgt-lang'],
        }),
      },
    );
    log.info(`Started tm-apply job #${started.jobId} ${mod.name} (#${mod.id})`);
    const done = await waitTmApply(mod.name, started.jobId);
    log.info(`  TM ${mod.name} done applied=${done.applied} skipped=${done.skipped}`);
  }
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
if (wantsTm) await runTmApplyForGroup();
await startWorkerStages(afterTm, exportOrderBody);

const wantsLangpack = stages.includes('export') || stages.includes('install') || Boolean(argv.out);
if (wantsLangpack && (argv.out || argv['install-staging'] || stages.includes('install'))) {
  const runId = await ensureRunId();
  const res = await fetch(apiUrl(`/api/vortex/sync/${runId}/langpack`), {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Langpack download failed: ${await res.text()}`);
  if (!res.body) throw new Error('Langpack download failed: empty body');
  const dest =
    argv.out ||
    path.join(inventory?.stagingPath ?? argv.staging, `fo4_${argv['tgt-lang']}_langpack.zip`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
  const destBytes = fs.statSync(dest).size;
  log.info(`Langpack saved: ${dest} (${(destBytes / 1024 / 1024).toFixed(1)} MiB)`);

  if (argv['install-staging'] || stages.includes('install')) {
    const folder = path.join(
      inventory?.stagingPath ?? argv.staging,
      `Transynth ${String(argv['tgt-lang']).toUpperCase()} Langpack`,
    );
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    await extractArchive(dest, folder);
    log.info(`Installed into staging: ${folder}`);
  }
}

log.info('Vortex sync finished.');
