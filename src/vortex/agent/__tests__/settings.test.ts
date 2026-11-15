import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import '../../../games';
import type { AgentApi } from '../apiClient';
import { autostartScript, readAutostart, setAutostart } from '../autostart';
import { defaultConfigPath } from '../config';
import { readConfigForm, saveConfigForm } from '../configForm';
import { AgentControl } from '../control';
import { defaultAgentPaths } from '../loop';
import { runAgent, type AgentPageStatus } from '../runner';
import type { AgentUi } from '../uiServer';

let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-settings-'));
  file = path.join(root, 'config', 'vortex-agent.json');
  fs.mkdirSync(path.join(root, 'staging'), { recursive: true });
  fs.mkdirSync(path.join(root, 'game', 'Data'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const form = (extra: Record<string, unknown> = {}) => ({
  api: 'http://host:3200/',
  game: 'fo4',
  stagingPath: path.join(root, 'staging'),
  gameDir: path.join(root, 'game'),
  downloadsDir: path.join(root, 'downloads'),
  pluginsTxt: '',
  pollSec: 20,
  settleSec: 0,
  ...extra,
});

const saved = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('the settings form', () => {
  it('shows the template until there is a file, and never the token', () => {
    const empty = readConfigForm(file, {});
    expect(empty).toMatchObject({ exists: false, tokenSet: false, tokenFromEnv: false });
    expect(empty.values).toMatchObject({ game: 'fo4', gameDir: '', pollSec: 30, uiPort: 3220 });
    expect(empty.games).toContain('fo4');

    saveConfigForm(file, form({ token: ' secret-token ' }), {});
    const filled = readConfigForm(file, { TRANSYNTH_CLI_TOKEN: 'env' });
    expect(filled).toMatchObject({ exists: true, tokenSet: true, tokenFromEnv: true });
    expect(JSON.stringify(filled)).not.toContain('secret-token');
  });

  it('writes what the agent would start with, and keeps what the form does not know', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ token: 'old', note: 'mine', vortexProfile: 'p1' }));
    const config = saveConfigForm(file, form({ vortexProfile: '' }), {
      TRANSYNTH_CLI_TOKEN: 'env',
    });
    expect(config).toMatchObject({ api: 'http://host:3200', token: 'env', pollSec: 20 });
    expect(saved()).toMatchObject({ api: 'http://host:3200', token: 'old', note: 'mine' });
    expect(saved()).not.toHaveProperty('vortexProfile');
    expect(saved()).not.toHaveProperty('pluginsTxt');

    saveConfigForm(file, form({ token: 'new' }), {});
    expect(saved().token).toBe('new');
    saveConfigForm(file, form({ clearToken: true }), {});
    expect(saved().token).toBe('');
  });

  it('refuses a form the agent could not start with and leaves the file alone', () => {
    saveConfigForm(file, form(), {});
    const before = fs.readFileSync(file, 'utf8');
    expect(() => saveConfigForm(file, form({ gameDir: path.join(root, 'nope') }), {})).toThrow(
      /gameDir does not exist/,
    );
    expect(() => saveConfigForm(file, form({ pollSec: null, uiPort: 'x' }), {})).toThrow(
      /pollSec must be a number; uiPort must be a number/,
    );
    expect(() => saveConfigForm(file, form({ pollSec: 1 }), {})).toThrow(/5 or more/);
    expect(() => saveConfigForm(file, form({ autoStages: 'llm' }), {})).toThrow(/autoStages/);
    expect(() => saveConfigForm(file, form({ game: 'disco' }), {})).toThrow(/deploys/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('autostart', () => {
  const target = () => ({ repoRoot: 'C:\\Source\\100% mine', configPath: defaultConfigPath() });

  it('writes a launcher that restarts the agent after a crash, from its clone', () => {
    const script = autostartScript(target());
    expect(script).toContain('cd /d "C:\\Source\\100%% mine"\r\n');
    expect(script).toContain('\r\ncall npm.cmd run vortex:agent\r\nif %errorlevel% neq 0 (');
    expect(autostartScript({ ...target(), configPath: 'D:\\a\\agent.json' })).toContain(
      'call npm.cmd run vortex:agent -- --config "D:\\a\\agent.json"\r\n',
    );
    expect(() => autostartScript({ ...target(), repoRoot: 'C:\\a"&calc' })).toThrow(/launcher/);
  });

  it('turns on and off by writing and removing one file, on Windows only', () => {
    const launcher = path.join(root, 'Startup', 'agent.cmd');
    expect(readAutostart(launcher, 'win32')).toMatchObject({ supported: true, enabled: false });
    expect(setAutostart(true, target(), launcher, 'win32').enabled).toBe(true);
    expect(fs.readFileSync(launcher, 'utf8')).toBe(autostartScript(target()));
    expect(setAutostart(false, target(), launcher, 'win32').enabled).toBe(false);
    expect(fs.existsSync(launcher)).toBe(false);
    expect(readAutostart(launcher, 'linux')).toMatchObject({ supported: false, enabled: false });
    expect(() => setAutostart(true, target(), launcher, 'linux')).toThrow(/Windows/);
  });
});

describe('the agent with a page', () => {
  const request = async (ui: AgentUi, method: string, suffix: string, body?: unknown) => {
    const res = await fetch(`${ui.url}${suffix}`, {
      method,
      headers: { 'X-Transynth-Agent': '1', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const until = async (check: () => Promise<boolean>): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the agent never got there');
  };

  it('comes up without a config, starts once the form is saved, and restarts on a new save', async () => {
    const control = new AgentControl();
    const apis: string[] = [];
    const heartbeat = jest.fn(async () => ({ ok: true, groupId: 1, latestLangpack: null }));
    let ui!: AgentUi;
    const launcher = path.join(root, 'Startup', 'agent.cmd');
    const running = runAgent({
      configPath: file,
      agentVersion: '1.2.3',
      repoRoot: root,
      control,
      paths: defaultAgentPaths(path.join(root, 'data')),
      autostartFile: launcher,
      createApi: (config) => {
        apis.push(config.api);
        return { heartbeat } as unknown as AgentApi;
      },
      onUi: (started) => {
        ui = started;
      },
    });
    const status = async () => (await request(ui, 'GET', 'api/status')).body as AgentPageStatus;

    await until(async () => ui !== undefined);
    expect(await status()).toMatchObject({ setup: true, reloading: false });
    expect(((await status()) as { configError: string }).configError).toMatch(/No agent config/);

    const refused = await request(ui, 'POST', 'api/settings', form({ gameDir: '' }));
    expect(refused).toMatchObject({
      status: 400,
      body: { error: expect.stringMatching(/gameDir/) },
    });
    expect(fs.existsSync(file)).toBe(false);

    // Port 0 in the form: the page that is up stays up, the file says 0 for the next start.
    expect((await request(ui, 'POST', 'api/settings', form({ uiPort: 0 }))).status).toBe(200);
    await until(async () => heartbeat.mock.calls.length > 0);
    expect(await status()).toMatchObject({ game: 'fo4', server: { api: 'http://host:3200' } });

    await request(ui, 'POST', 'api/settings', form({ api: 'http://other:3200', uiPort: 0 }));
    await until(async () => apis.length === 2);
    expect(apis).toEqual(['http://host:3200', 'http://other:3200']);

    if (process.platform === 'win32') {
      expect((await request(ui, 'POST', 'api/autostart/on')).status).toBe(200);
      expect((await status()).autostart).toMatchObject({ enabled: true, file: launcher });
      expect(fs.readFileSync(launcher, 'utf8')).toContain(`--config "${file}"`);
      await request(ui, 'POST', 'api/autostart/off');
      expect(fs.existsSync(launcher)).toBe(false);
    }

    await request(ui, 'POST', 'api/command/stop');
    await running;
  });

  it('without a page a missing config is still an error', async () => {
    await expect(
      runAgent({ configPath: file, agentVersion: '1.2.3', repoRoot: root, ui: false }),
    ).rejects.toThrow(/No agent config/);
  });
});
