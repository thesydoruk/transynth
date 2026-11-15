/**
 * The resident agent as one process: the loop, its page, and the settings the
 * page can change. Saving the form ends the loop after its tick and starts a
 * new one from the file. With no usable config the page still comes up, in
 * setup mode, and the loop starts once the form is saved — unless there is no
 * page to fix it on, and then a bad config is the error it always was.
 */
import os from 'node:os';
import { log } from '../../logger';
import { createAgentApi, type AgentApi } from './apiClient';
import { readAutostart, setAutostart, type AutostartStatus } from './autostart';
import { DEFAULT_UI_PORT, loadAgentConfig, type AgentConfig } from './config';
import { readConfigForm, saveConfigForm } from './configForm';
import { AgentControl } from './control';
import { VortexAgentLoop, defaultAgentPaths, type AgentPaths } from './loop';
import { buildAgentStatus, type AgentStatus } from './status';
import { startAgentUi, type AgentUi } from './uiServer';

export type RunAgentOptions = {
  configPath: string;
  agentVersion: string;
  /** The clone the agent runs from, for the autostart launcher. */
  repoRoot: string;
  once?: boolean;
  /** Serve the page; off with `--no-ui`, never with `once`. */
  ui?: boolean;
  control?: AgentControl;
  paths?: AgentPaths;
  createApi?: (config: AgentConfig) => AgentApi;
  autostartFile?: string;
  /** Called with the page once it is up (tests read its port). */
  onUi?: (ui: AgentUi) => void;
};

/** What the page gets while there is no config the agent can start with. */
export type AgentSetupStatus = {
  setup: true;
  version: string;
  machine: string;
  configError: string;
  paths: { config: string };
};

export type AgentPageStatus = (AgentStatus | AgentSetupStatus) & {
  /** Settings were saved and wait for the current step to end. */
  reloading: boolean;
  autostart: AutostartStatus;
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const runAgent = async (opts: RunAgentOptions): Promise<void> => {
  const control = opts.control ?? new AgentControl();
  const paths = opts.paths ?? defaultAgentPaths();
  const createApi =
    opts.createApi ?? ((c: AgentConfig) => createAgentApi({ api: c.api, token: c.token }));
  const withUi = opts.ui !== false && !opts.once;
  let running: { config: AgentConfig; loop: VortexAgentLoop } | null = null;
  let configError = '';

  const load = (): AgentConfig | null => {
    try {
      return loadAgentConfig(opts.configPath);
    } catch (err) {
      // The page is where the config gets written now; `--init` is the CLI's advice.
      configError = message(err).replace(/ — run with --init.*$/, '');
      return null;
    }
  };

  const status = (): AgentPageStatus => ({
    ...(running
      ? buildAgentStatus({
          config: running.config,
          configPath: opts.configPath,
          journalPath: paths.journal,
          agentVersion: opts.agentVersion,
          control,
          view: () => running!.loop.view(),
        })
      : {
          setup: true as const,
          version: opts.agentVersion,
          machine: os.hostname(),
          configError,
          paths: { config: opts.configPath },
        }),
    reloading: control.reloading,
    autostart: readAutostart(opts.autostartFile),
  });

  let config = load();
  let ui: AgentUi | null = null;
  const port = config?.uiPort ?? DEFAULT_UI_PORT;
  if (withUi && port > 0) {
    try {
      ui = await startAgentUi({
        port,
        status,
        command: (command) => {
          log.info(`vortex-agent: ${command} requested from the page`);
          control.command(command);
        },
        settings: {
          read: () => readConfigForm(opts.configPath),
          save: (form) => {
            saveConfigForm(opts.configPath, form);
            log.info('vortex-agent: settings saved from the page');
            control.reload();
          },
        },
        autostart: (enabled) => {
          setAutostart(
            enabled,
            { repoRoot: opts.repoRoot, configPath: opts.configPath },
            opts.autostartFile,
          );
          log.info(`vortex-agent: autostart turned ${enabled ? 'on' : 'off'} from the page`);
        },
      });
      log.info(`vortex-agent: page at ${ui.url}`);
      opts.onUi?.(ui);
    } catch (err) {
      // Another agent on the port, most likely: the loop is what matters.
      log.warn(`vortex-agent: no page on port ${port}: ${message(err)}`);
    }
  }

  try {
    while (!control.stopping) {
      control.reloading = false;
      config = load();
      if (!config) {
        if (!ui) return void loadAgentConfig(opts.configPath);
        log.warn(`vortex-agent: ${configError} — fill the settings in at ${ui.url}`);
        while (!control.stopping && !control.reloading) await control.sleep(60_000);
        continue;
      }
      log.info(
        `vortex-agent ${opts.agentVersion}: ${config.stagingPath} → ${config.api}, auto stages up to ${config.autoStages}, poll ${config.pollSec}s`,
      );
      const loop = new VortexAgentLoop({
        config,
        api: createApi(config),
        paths,
        agentVersion: opts.agentVersion,
        once: opts.once,
        control,
      });
      running = { config, loop };
      await loop.run();
      if (opts.once) break;
    }
  } finally {
    await ui?.close();
  }
};
