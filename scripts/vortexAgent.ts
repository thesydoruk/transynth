#!/usr/bin/env tsx
/**
 * The resident Vortex agent: keeps a Vortex staging folder mirrored on the
 * server, runs import → carry → TM on its own, and drops finished langpacks
 * into Vortex's downloads folder. It never starts LLM, verify, voice or export.
 *
 *   npm run vortex:agent -- --init                 # write %APPDATA%\Transynth\vortex-agent.json
 *   npm run vortex:agent -- --dry-run              # inventory and load order, no server calls
 *   npm run vortex:agent -- --once                 # one tick, sync if anything changed, exit
 *   npm run vortex:agent -- --install-rad-tools    # fetch radvideo64.exe for the video dubs, exit
 *   npm run vortex:agent                           # loop until SIGINT / SIGTERM
 */
import '../src/games';
import '../src/loadEnv';
import { createRequire } from 'node:module';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { createAgentApi } from '../src/vortex/agent/apiClient';
import {
  defaultConfigPath,
  loadAgentConfig,
  writeConfigTemplate,
} from '../src/vortex/agent/config';
import { VortexAgentLoop, defaultAgentPaths } from '../src/vortex/agent/loop';
import { installRadVideoTools } from '../src/vortex/agent/radTools';
import { scanForSync } from '../src/vortex/agent/syncCycle';
import { loadHashCache, saveHashCache } from '../src/vortex/agent/hashCache';
import { emptyAgentState } from '../src/vortex/agent/state';

const argv = await yargs(hideBin(process.argv))
  .scriptName('vortex:agent')
  .option('config', { type: 'string', default: defaultConfigPath(), describe: 'Agent config file' })
  .option('init', { type: 'boolean', default: false, describe: 'Write a config template and exit' })
  .option('once', { type: 'boolean', default: false, describe: 'One tick, then exit' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Scan only, no server calls' })
  .option('install-rad-tools', {
    type: 'boolean',
    default: false,
    describe: 'Download the RAD Video Tools (radvideo64.exe) into radVideoToolsPath and exit',
  })
  .help()
  .parse();

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

if (argv.init) {
  const file = writeConfigTemplate(argv.config);
  log.info(`Wrote ${file} — fill in gameDir (and api, token) before the first run`);
  process.exit(0);
}

const config = loadAgentConfig(argv.config);
const paths = defaultAgentPaths();
const api = createAgentApi({ api: config.api, token: config.token });

if (argv['install-rad-tools']) {
  const exe = await installRadVideoTools({
    toolsDir: config.radVideoToolsPath,
    log: (line) => log.info(`RAD tools: ${line}`),
  });
  log.info(`RAD Video Tools installed: ${exe}`);
  process.exit(0);
}

if (argv['dry-run']) {
  const cache = loadHashCache(paths.cache);
  const scan = await scanForSync({ config, state: emptyAgentState(), cache, api });
  saveHashCache(paths.cache, cache);
  log.info(
    `Dry run: ${scan.inventory.units.length} unit(s), game ${scan.inventory.gameRelease.versionLabel}, hash cache ${scan.hashCounters.hits} hit / ${scan.hashCounters.misses} miss`,
  );
  for (const unit of scan.inventory.units) {
    log.info(
      `  [${unit.channel}] ${unit.name}  ${unit.contentHash.slice(0, 12)}  ${unit.files.length} file(s)`,
    );
  }
  log.info(
    `Load order: ${scan.exportOrder.plugins.length} plugin(s), ${scan.exportOrder.enabledPlugins?.length ?? 0} enabled, ${scan.exportOrder.fileWinners.length} deployed file(s)`,
  );
  process.exit(0);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!stopping) log.info('vortex-agent: stopping after this tick');
    stopping = true;
  });
}

log.info(
  `vortex-agent ${version}: ${config.stagingPath} → ${config.api}, auto stages up to ${config.autoStages}, poll ${config.pollSec}s`,
);
const loop = new VortexAgentLoop({
  config,
  api,
  paths,
  agentVersion: version,
  once: argv.once,
  isStopping: () => stopping,
});
await loop.run();
