/**
 * Global pool for Fish Speech TTS HTTP requests (`POST /v1/synthesize`).
 *
 * Limit is configured in project settings (Settings → Voice) and synced at
 * startup and whenever that setting changes.
 */
import { SETTING_DEFAULTS } from '../web/services/projectSettings';
import { Semaphore } from '../utils/concurrency';

export type TtsRequestPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
};

/** Bounded-concurrency wrapper for TTS HTTP requests. */
export class TtsRequestPool {
  private pool: Semaphore;

  constructor(maxParallel: number) {
    this.pool = new Semaphore(maxParallel);
  }

  syncLimit(maxParallel: number): void {
    this.pool.setMaxConcurrency(maxParallel);
  }

  get maxParallel(): number {
    return this.pool.maxConcurrency;
  }

  /** Worker count for voice batch jobs — overlaps prep I/O with the next TTS slot. */
  pipelineConcurrency(): number {
    return this.maxParallel + 1;
  }

  get stats(): TtsRequestPoolStats {
    return {
      inFlight: this.pool.activeCount,
      queued: this.pool.queuedCount,
      max: this.pool.maxConcurrency,
    };
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.pool.run(fn);
  }
}

/** Shared TTS HTTP pool — used by {@link synthesizeWav}. */
export const ttsPool = new TtsRequestPool(SETTING_DEFAULTS['voice.tts_max_parallel_fish_speech']);

/** Apply project-settings limit to the global TTS pool. */
export const syncTtsPoolLimit = (maxParallel: number): void => {
  ttsPool.syncLimit(maxParallel);
};

/** Worker count for mod voice batch synthesis. */
export const ttsPipelineConcurrency = (): number => ttsPool.pipelineConcurrency();
