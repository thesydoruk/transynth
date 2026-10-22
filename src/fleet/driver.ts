/**
 * How the controller touches a host: Docker Compose on the host over ssh, and
 * `nvidia-smi` the same way for the card's real memory use. Nothing is installed on hosts.
 *
 * Compose has to run *on* the host: `docker --context <ssh> compose` only moves the engine
 * API over ssh and still reads the compose files from the controller's own disk, which
 * does not have them. So a host with `ssh` gets `ssh <host> docker compose …`; a host with
 * only a docker `context` is assumed to share the controller's filesystem (the controller
 * runs on that box) and gets `docker --context <ctx> compose …`.
 *
 * The interface is what the scheduler tests fake; `ShellHostDriver` is the real thing.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { FleetHost, FleetService } from './inventory';

export type ContainerState = 'running' | 'stopped' | 'missing';

export type HostDriver = {
  containerState(host: FleetHost, service: FleetService): Promise<ContainerState>;
  up(host: FleetHost, service: FleetService): Promise<void>;
  stop(host: FleetHost, service: FleetService): Promise<void>;
  /** Used VRAM on one GPU in MB, or null when the host gives no reading. */
  gpuUsedMb(host: FleetHost, gpuIndex: number): Promise<number | null>;
};

const run = (file: string, args: string[], timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`${file} ${args.join(' ')}: ${stderr?.toString().trim() || err.message}`),
          );
          return;
        }
        resolve(stdout.toString());
      },
    );
  });

/** POSIX single-quote one word for the remote shell ssh runs the command through. */
export const shellQuote = (word: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];

/** `docker compose` with the project pinned by absolute paths, so the cwd does not matter. */
export const composeCommand = (service: FleetService, verb: string[]): string[] => {
  const { dir, files, project } = service.compose;
  const args = ['compose', '--project-directory', dir];
  for (const file of files) {
    args.push('-f', path.posix.isAbsolute(file) ? file : path.posix.join(dir, file));
  }
  if (project) args.push('-p', project);
  return [...args, ...verb];
};

type ComposePsRow = { Service?: string; State?: string };

/** `compose ps --format json` prints one object per line, or an array on older versions. */
export const parseComposePs = (out: string): ComposePsRow[] => {
  const trimmed = out.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as ComposePsRow[];
  return trimmed
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ComposePsRow);
};

/**
 * A service is up only when every one of its compose services runs: Fish Speech is an
 * engine plus a gateway, and a stopped gateway with the engine still holding VRAM must
 * read as "stopped" so the controller starts the gateway again (or stops the engine).
 */
export const containerStateOf = (
  rows: ComposePsRow[],
  services: readonly string[],
): ContainerState => {
  if (rows.length === 0) return 'missing';
  const running = new Set(rows.filter((r) => r.State === 'running').map((r) => r.Service));
  return services.every((name) => running.has(name)) ? 'running' : 'stopped';
};

export class ShellHostDriver implements HostDriver {
  constructor(private readonly commandTimeoutMs = 120_000) {}

  /** Run `docker <args>` where the host's compose files live. */
  private docker(host: FleetHost, args: string[], timeoutMs: number): Promise<string> {
    if (host.ssh) {
      const remote = ['docker', ...args].map(shellQuote).join(' ');
      return run('ssh', [...SSH_OPTS, host.ssh, remote], timeoutMs);
    }
    if (host.context) return run('docker', ['--context', host.context, ...args], timeoutMs);
    return Promise.reject(new Error(`fleet: host ${host.name} has neither ssh nor context`));
  }

  async containerState(host: FleetHost, service: FleetService): Promise<ContainerState> {
    const out = await this.docker(
      host,
      composeCommand(service, ['ps', '--all', '--format', 'json', ...service.compose.services]),
      this.commandTimeoutMs,
    );
    return containerStateOf(parseComposePs(out), service.compose.services);
  }

  async up(host: FleetHost, service: FleetService): Promise<void> {
    await this.docker(
      host,
      composeCommand(service, ['up', '-d', '--no-recreate', ...service.compose.services]),
      this.commandTimeoutMs,
    );
  }

  async stop(host: FleetHost, service: FleetService): Promise<void> {
    await this.docker(
      host,
      composeCommand(service, ['stop', ...service.compose.services]),
      this.commandTimeoutMs,
    );
  }

  async gpuUsedMb(host: FleetHost, gpuIndex: number): Promise<number | null> {
    if (!host.ssh) return null;
    try {
      const out = await run(
        'ssh',
        [
          ...SSH_OPTS,
          host.ssh,
          'nvidia-smi',
          '--query-gpu=memory.used',
          '--format=csv,noheader,nounits',
          '-i',
          String(gpuIndex),
        ],
        30_000,
      );
      const n = Number.parseInt(out.trim().split('\n')[0] ?? '', 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}
