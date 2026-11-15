/**
 * What the agent's local page and its loop share: the commands the page sends
 * (taken by the loop at the start of a tick) and the live facts the loop has
 * and the state file does not — what it is doing right now, whether the server
 * answered, what the last scan saw.
 */
import type { VortexLatestLangpack } from '../types';

export type AgentCommand = 'sync' | 'pause' | 'resume' | 'redeliver' | 'stop';

export const AGENT_COMMANDS: readonly AgentCommand[] = [
  'sync',
  'pause',
  'resume',
  'redeliver',
  'stop',
];

/** `file` grows towards `total` bytes while the activity lasts (a download). */
export type AgentActivity = { text: string; file?: string; total?: number };

export type AgentScanSummary = {
  at: string;
  units: number;
  gameVersion: string | null;
  plugins: number;
  enabledPlugins: number;
};

type Request = 'sync' | 'redeliver';

export class AgentControl {
  /** No sync, upload or delivery on the agent's own initiative; not kept across a restart. */
  paused = false;
  stopping = false;
  /** New settings were saved: the loop ends after its tick and starts again with them. */
  reloading = false;
  activity: AgentActivity | null = null;
  heartbeat: { at: string | null; ok: boolean | null; error: string | null } = {
    at: null,
    ok: null,
    error: null,
  };
  latestLangpack: VortexLatestLangpack | null = null;
  scan: AgentScanSummary | null = null;
  /** Units the server refused in the last sync (nothing it can import). */
  rejected: string[] = [];
  private readonly requests = new Set<Request>();
  private wake: (() => void) | null = null;

  command(command: AgentCommand): void {
    if (command === 'pause') this.paused = true;
    else if (command === 'resume') this.paused = false;
    else if (command === 'stop') this.stopping = true;
    else this.requests.add(command);
    this.wake?.();
  }

  reload(): void {
    this.reloading = true;
    this.wake?.();
  }

  wants(request: Request): boolean {
    return this.requests.has(request);
  }

  /** True once per request: the loop takes it and acts. */
  take(request: Request): boolean {
    return this.requests.delete(request);
  }

  heartbeatResult(error: string | null): void {
    this.heartbeat = { at: new Date().toISOString(), ok: error == null, error };
  }

  /** The loop's wait between ticks; a command ends it early. */
  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}
