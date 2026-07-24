/**
 * Global per-backend pools for TTS HTTP requests (`POST /v1/synthesize`).
 *
 * Limits are configured in project settings (Settings → Voice) and synced at
 * startup and whenever those settings change.
 */
import { SETTING_DEFAULTS } from '../web/services/projectSettings';
import { Semaphore } from '../utils/concurrency';
import type { TtsBackend } from './xttsClient';

export type TtsBackendPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
};

export type TtsRequestPoolStats = Record<TtsBackend, TtsBackendPoolStats>;

export type TtsMaxParallelLimits = Record<TtsBackend, number>;

const resolveBackend = (backend: TtsBackend | undefined): TtsBackend => backend ?? 'xtts';

const defaultLimits = (): TtsMaxParallelLimits => ({
  xtts: SETTING_DEFAULTS['voice.tts_max_parallel_xtts'],
  'fish-speech': SETTING_DEFAULTS['voice.tts_max_parallel_fish_speech'],
});

/** Bounded-concurrency wrapper with per-backend semaphores. */
export class TtsRequestPool {
  private readonly pools: Record<TtsBackend, Semaphore>;

  constructor(limits: TtsMaxParallelLimits) {
    this.pools = {
      xtts: new Semaphore(limits.xtts),
      'fish-speech': new Semaphore(limits['fish-speech']),
    };
  }

  syncLimits(limits: TtsMaxParallelLimits): void {
    for (const backend of ['xtts', 'fish-speech'] as const) {
      this.pools[backend].setMaxConcurrency(limits[backend]);
    }
  }

  maxParallel(backend: TtsBackend | undefined): number {
    return this.pools[resolveBackend(backend)].maxConcurrency;
  }

  /** Worker count for voice batch jobs — overlaps prep I/O with the next TTS slot. */
  pipelineConcurrency(backend: TtsBackend | undefined): number {
    return this.maxParallel(backend) + 1;
  }

  get stats(): TtsRequestPoolStats {
    return {
      xtts: this.statsFor('xtts'),
      'fish-speech': this.statsFor('fish-speech'),
    };
  }

  run<T>(backend: TtsBackend | undefined, fn: () => Promise<T>): Promise<T> {
    return this.pools[resolveBackend(backend)].run(fn);
  }

  private statsFor(backend: TtsBackend): TtsBackendPoolStats {
    const pool = this.pools[backend];
    return {
      inFlight: pool.activeCount,
      queued: pool.queuedCount,
      max: pool.maxConcurrency,
    };
  }
}

/** Shared TTS HTTP pool — used by {@link synthesizeXttsWav}. */
export const ttsPool = new TtsRequestPool(defaultLimits());

/** Apply project-settings limits to the global TTS pool. */
export const syncTtsPoolLimits = (limits: TtsMaxParallelLimits): void => {
  ttsPool.syncLimits(limits);
};

/** Worker count for mod voice batch synthesis. */
export const ttsPipelineConcurrency = (backend: TtsBackend | undefined): number =>
  ttsPool.pipelineConcurrency(backend);
