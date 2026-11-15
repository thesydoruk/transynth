import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { AgentCommand } from '../control';
import { isOwnHost, isOwnRequest, startAgentUi, type AgentUi } from '../uiServer';

type Reply = { status: number; type: string; body: string };

/** A raw request: `fetch` will not let a test set Host or Origin. */
const request = (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'] ?? '', body }),
      );
    });
    req.on('error', reject);
    req.end();
  });

describe('the agent page server', () => {
  let ui: AgentUi;
  let commands: AgentCommand[];
  const own = { 'X-Transynth-Agent': '1' };

  beforeEach(async () => {
    commands = [];
    ui = await startAgentUi({
      port: 0,
      status: () => ({ state: 'idle' }),
      command: (command) => commands.push(command),
    });
  });

  afterEach(async () => {
    await ui.close();
  });

  it('serves the page and the status on loopback', async () => {
    const page = await request(ui.port, 'GET', '/');
    expect(page.status).toBe(200);
    expect(page.type).toMatch(/^text\/html/);
    expect(page.body).toContain('Vortex agent');
    const status = await request(ui.port, 'GET', '/api/status');
    expect(JSON.parse(status.body)).toEqual({ state: 'idle' });
    expect((await request(ui.port, 'GET', '/nope')).status).toBe(404);
  });

  it('takes a command from its own page', async () => {
    const origin = `http://127.0.0.1:${ui.port}`;
    expect((await request(ui.port, 'POST', '/api/command/sync', own)).status).toBe(200);
    expect(
      (await request(ui.port, 'POST', '/api/command/pause', { ...own, Origin: origin })).status,
    ).toBe(200);
    expect(commands).toEqual(['sync', 'pause']);
    expect((await request(ui.port, 'POST', '/api/command/format', own)).status).toBe(404);
    expect((await request(ui.port, 'GET', '/api/command/stop', own)).status).toBe(404);
    expect(commands).toEqual(['sync', 'pause']);
  });

  it('refuses a command from another site, and any request under another host name', async () => {
    const stop = '/api/command/stop';
    expect((await request(ui.port, 'POST', stop)).status).toBe(403);
    expect(
      (await request(ui.port, 'POST', stop, { ...own, Origin: 'http://evil.example' })).status,
    ).toBe(403);
    expect(
      (await request(ui.port, 'POST', stop, { ...own, Host: `evil.example:${ui.port}` })).status,
    ).toBe(403);
    expect(
      (await request(ui.port, 'GET', '/api/status', { Host: `evil.example:${ui.port}` })).status,
    ).toBe(403);
    expect(commands).toEqual([]);
  });

  it('fails to start on a taken port instead of taking the agent down later', async () => {
    await expect(
      startAgentUi({ port: ui.port, status: () => ({}), command: () => undefined }),
    ).rejects.toThrow(/EADDRINUSE/);
  });

  it('knows its own host and its own page', () => {
    expect(isOwnHost('localhost:3220', 3220)).toBe(true);
    expect(isOwnHost('127.0.0.1:3221', 3220)).toBe(false);
    expect(isOwnHost(undefined, 3220)).toBe(false);
    expect(isOwnRequest({ 'x-transynth-agent': '1' }, 3220)).toBe(true);
    expect(isOwnRequest({ origin: 'http://localhost:3220' }, 3220)).toBe(false);
  });
});
