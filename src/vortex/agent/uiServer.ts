/**
 * The agent's own page: a tiny HTTP server on 127.0.0.1 with the page, its
 * status JSON and the commands. It is for the person at this machine only, so
 * it listens on loopback, answers only when addressed as loopback (a DNS name
 * rebound to 127.0.0.1 is refused) and takes a command only from its own page.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AGENT_COMMANDS, type AgentCommand } from './control';
import { AGENT_UI_PAGE } from './uiPage';

export type AgentUiOptions = {
  port: number;
  status: () => unknown;
  command: (command: AgentCommand) => void;
  /** The settings form: what it shows, and saving it (throws with what is wrong). */
  settings?: { read: () => unknown; save: (form: unknown) => void };
  /** Turn the start-at-sign-in launcher on or off; throws when it cannot. */
  autostart?: (enabled: boolean) => void;
};

export type AgentUi = { url: string; port: number; close: () => Promise<void> };

const LOOPBACK = '127.0.0.1';

/** `127.0.0.1:<port>` or `localhost:<port>`, nothing else. */
export const isOwnHost = (host: string | undefined, port: number): boolean =>
  host === `${LOOPBACK}:${port}` || host === `localhost:${port}`;

/** A command must come from the agent's page: its origin and its marker header. */
export const isOwnRequest = (headers: http.IncomingHttpHeaders, port: number): boolean => {
  if (headers['x-transynth-agent'] !== '1') return false;
  const origin = headers.origin;
  return (
    origin === undefined ||
    origin === `http://${LOOPBACK}:${port}` ||
    origin === `http://localhost:${port}`
  );
};

const send = (res: http.ServerResponse, status: number, type: string, body: string): void => {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
};

const json = (res: http.ServerResponse, status: number, body: unknown): void =>
  send(res, status, 'application/json', JSON.stringify(body));

const MAX_BODY = 64 * 1024;

const readJsonBody = (req: http.IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        if (size > MAX_BODY) throw new Error('the form is too large');
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const startAgentUi = (opts: AgentUiOptions): Promise<AgentUi> =>
  new Promise((resolve, reject) => {
    let port = opts.port;
    const server = http.createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      if (!isOwnHost(req.headers.host, port)) return json(res, 403, { error: 'not for this host' });
      if (req.method === 'GET' && path === '/') return send(res, 200, 'text/html', AGENT_UI_PAGE);
      if (req.method === 'GET' && path === '/api/status') return json(res, 200, opts.status());
      if (req.method === 'GET' && path === '/api/settings' && opts.settings) {
        return json(res, 200, opts.settings.read());
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      if (!isOwnRequest(req.headers, port)) {
        req.resume();
        return json(res, 403, { error: 'not from the page' });
      }
      if (path === '/api/settings' && opts.settings) {
        const { save } = opts.settings;
        readJsonBody(req)
          .then(save)
          .then(
            () => json(res, 200, { ok: true }),
            (err: unknown) => json(res, 400, { error: message(err) }),
          );
        return;
      }
      req.resume();
      const toggle = /^\/api\/autostart\/(on|off)$/.exec(path)?.[1];
      if (toggle !== undefined && opts.autostart) {
        try {
          opts.autostart(toggle === 'on');
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 400, { error: message(err) });
        }
      }
      const command = /^\/api\/command\/([a-z]+)$/.exec(path)?.[1] as AgentCommand | undefined;
      if (command !== undefined && AGENT_COMMANDS.includes(command)) {
        opts.command(command);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    });
    server.once('error', reject);
    server.listen(opts.port, LOOPBACK, () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://${LOOPBACK}:${port}/`,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
