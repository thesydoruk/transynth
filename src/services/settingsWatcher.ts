/**
 * Re-read the service-related project settings on a timer, so a process picks up rows
 * written behind its back — above all the `managed` rows the fleet controller writes
 * into `services.endpoints` when it brings a GPU service up or down. Boot and the
 * settings API already sync the registry; this covers every other writer.
 *
 * The first read only records what is there (boot synced it); later reads apply the
 * settings when any of the watched keys changed. `SERVICES_SETTINGS_POLL_SEC` (default
 * 30) sets the interval; 0 disables the watcher.
 */
import type { ProjectSettings } from '../web/services/projectSettings';

const WATCHED_KEYS = [
  'services.endpoints',
  'llm.vllm_servers',
  'voice.tts_max_parallel_fish_speech',
] as const;

export type SettingsWatcherDeps = {
  read: () => Promise<ProjectSettings>;
  apply: (settings: ProjectSettings) => void;
  log: { info: (msg: string, meta?: object) => void; warn: (msg: string, meta?: object) => void };
  /** Scheduler hook for tests; defaults to setInterval with an unref'd timer. */
  schedule?: (fn: () => void, intervalMs: number) => () => void;
};

export const settingsPollMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = Number.parseInt(env.SERVICES_SETTINGS_POLL_SEC ?? '', 10);
  if (Number.isFinite(raw) && raw >= 0) return raw * 1000;
  return 30_000;
};

const fingerprint = (settings: ProjectSettings): string =>
  JSON.stringify(WATCHED_KEYS.map((key) => settings[key] ?? null));

/**
 * Start watching; returns a stop function. One tick runs at once to record the current
 * state, so a change made between boot and the first tick is applied on the next one.
 */
export const startServiceSettingsWatcher = (
  deps: SettingsWatcherDeps,
  intervalMs: number = settingsPollMs(),
): (() => void) => {
  if (intervalMs <= 0) return () => {};
  let last: string | null = null;
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const settings = await deps.read();
      const now = fingerprint(settings);
      if (last !== null && now !== last) {
        deps.apply(settings);
        deps.log.info('services: endpoints reloaded from project settings');
      }
      last = now;
    } catch (err) {
      deps.log.warn('services: settings reload failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };
  const schedule =
    deps.schedule ??
    ((fn, ms) => {
      const timer = setInterval(fn, ms);
      timer.unref();
      return () => clearInterval(timer);
    });
  void tick();
  return schedule(() => void tick(), intervalMs);
};
