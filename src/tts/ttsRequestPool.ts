/**
 * Global per-backend pools for TTS HTTP requests (`POST /v1/synthesize`).
 *
 * XTTS and Fish Speech share one TTS server but may have different GPU load
 * characteristics — limits are configured separately via env.
 */
import { CONFIG } from '../config';
import { Semaphore } from '../utils/concurrency';
import type { TtsBackend } from './xttsClient';

export type TtsBackendPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
};

export type TtsRequestPoolStats = Record<TtsBackend, TtsBackendPoolStats>;

const resolveBackend = (backend: TtsBackend | undefined): TtsBackend => backend ?? 'xtts';

/** Bounded-concurrency wrapper with per-backend semaphores. */
export class TtsRequestPool {
  private readonly pools: Record<TtsBackend, Semaphore>;

  constructor(limits: Record<TtsBackend, number>) {
    this.pools = {
      xtts: new Semaphore(limits.xtts),
      'fish-speech': new Semaphore(limits['fish-speech']),
    };
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
export const ttsPool = new TtsRequestPool({
  xtts: CONFIG.ttsXttsMaxParallel,
  'fish-speech': CONFIG.ttsFishSpeechMaxParallel,
});

/** Worker count for mod voice batch synthesis. */
export const ttsPipelineConcurrency = (backend: TtsBackend | undefined): number =>
  ttsPool.pipelineConcurrency(backend);
