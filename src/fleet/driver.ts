/**
 * How the controller touches a host: Docker Compose through a docker context (ssh), and
 * `nvidia-smi` over ssh for the card's real memory use. Nothing is installed on hosts.
 *
 * The interface is what the scheduler tests fake; `ShellHostDriver` is the real thing.
 */
import { execFile } from 'node:child_process';
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

const composeArgs = (host: FleetHost, service: FleetService): string[] => [
  '--context',
  host.context,
  'compose',
  '--project-directory',
  service.compose.dir,
  ...(service.compose.project ? ['-p', service.compose.project] : []),
];

export class ShellHostDriver implements HostDriver {
  constructor(private readonly commandTimeoutMs = 120_000) {}

  async containerState(host: FleetHost, service: FleetService): Promise<ContainerState> {
    const out = await run(
      'docker',
      [...composeArgs(host, service), 'ps', '--all', '--format', 'json', service.compose.service],
      this.commandTimeoutMs,
    );
    // `compose ps --format json` prints one JSON object per line (or an array on older versions).
    const rows: Array<{ State?: string; Health?: string }> = [];
    const trimmed = out.trim();
    if (!trimmed) return 'missing';
    if (trimmed.startsWith('[')) {
      rows.push(...(JSON.parse(trimmed) as Array<{ State?: string }>));
    } else {
      for (const line of trimmed.split('\n')) {
        if (line.trim()) rows.push(JSON.parse(line) as { State?: string });
      }
    }
    if (rows.length === 0) return 'missing';
    return rows.some((r) => r.State === 'running') ? 'running' : 'stopped';
  }

  async up(host: FleetHost, service: FleetService): Promise<void> {
    await run(
      'docker',
      [...composeArgs(host, service), 'up', '-d', '--no-recreate', service.compose.service],
      this.commandTimeoutMs,
    );
  }

  async stop(host: FleetHost, service: FleetService): Promise<void> {
    await run(
      'docker',
      [...composeArgs(host, service), 'stop', service.compose.service],
      this.commandTimeoutMs,
    );
  }

  async gpuUsedMb(host: FleetHost, gpuIndex: number): Promise<number | null> {
    if (!host.ssh) return null;
    try {
      const out = await run(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=10',
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
