#!/usr/bin/env tsx
/**
 * The resident Vortex agent: keeps a Vortex staging folder mirrored on the
 * server, runs import → carry → TM on its own, and drops finished langpacks
 * into Vortex's downloads folder. It never starts LLM, verify, voice or export.
 *
 *   npm run vortex:agent -- --init                 # write %APPDATA%\Transynth\vortex-agent.json
 *   npm run vortex:agent -- --dry-run              # inventory and load order, no server calls
 *   npm run vortex:agent -- --once                 # one tick, sync if anything changed, exit
 *   npm run vortex:agent                           # loop until SIGINT / SIGTERM
 *
 * While it loops, its own page is at http://127.0.0.1:<uiPort>/ (3220 unless
 * the config says otherwise; 0 or --no-ui turns it off). The page also edits
 * the config, so a first run needs no --init: start the agent and open it.
 */
import '../src/games';
import '../src/loadEnv';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { createAgentApi } from '../src/vortex/agent/apiClient';
import {
  defaultConfigPath,
  loadAgentConfig,
  writeConfigTemplate,
} from '../src/vortex/agent/config';
import { AgentControl } from '../src/vortex/agent/control';
import { defaultAgentPaths } from '../src/vortex/agent/loop';
import { runAgent } from '../src/vortex/agent/runner';
import { scanForSync } from '../src/vortex/agent/syncCycle';
import { loadHashCache, saveHashCache } from '../src/vortex/agent/hashCache';
import { emptyAgentState } from '../src/vortex/agent/state';

const argv = await yargs(hideBin(process.argv))
  .scriptName('vortex:agent')
  .option('config', { type: 'string', default: defaultConfigPath(), describe: 'Agent config file' })
  .option('init', { type: 'boolean', default: false, describe: 'Write a config template and exit' })
  .option('once', { type: 'boolean', default: false, describe: 'One tick, then exit' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Scan only, no server calls' })
  .option('ui', { type: 'boolean', default: true, describe: 'Serve the agent page on 127.0.0.1' })
  .help()
  .parse();

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

if (argv.init) {
  const file = writeConfigTemplate(argv.config);
  log.info(`Wrote ${file} — fill in gameDir (and api, token) before the first run`);
  process.exit(0);
}

if (argv['dry-run']) {
  const config = loadAgentConfig(argv.config);
  const paths = defaultAgentPaths();
  const api = createAgentApi({ api: config.api, token: config.token });
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

const control = new AgentControl();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!control.stopping) log.info('vortex-agent: stopping after this tick');
    control.command('stop');
  });
}

await runAgent({
  configPath: argv.config,
  agentVersion: version,
  repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  once: argv.once,
  ui: argv.ui,
  control,
});
