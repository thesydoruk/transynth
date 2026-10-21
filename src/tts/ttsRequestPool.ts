/**
 * Fish Speech requests go through the `tts` service pool.
 *
 * Endpoints come from the service registry: `services.endpoints` rows of kind `tts`,
 * else `TTS_BASE_URL` with the limit from Settings → Voice
 * (`voice.tts_max_parallel_fish_speech`). Several TTS servers are therefore several
 * rows, each with its own limit, and a server that refuses connections leaves the pool
 * until its health probe passes again.
 */
import { servicePool, type UrlPool } from '../services/pools';
import type { ServicePoolStats } from '../services/pool';

export type TtsRequestPoolStats = ServicePoolStats;

const pool = (): UrlPool => servicePool('tts');

/** Shared TTS pool — used by {@link synthesizeWav}. */
export const ttsPool = {
  /** Run one request on the least-loaded healthy TTS host; `fn` gets its base URL. */
  run<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    return pool().run((baseUrl) => fn(baseUrl));
  },
  get stats(): TtsRequestPoolStats {
    return pool().stats;
  },
  /** Sum of per-host limits. */
  get maxParallel(): number {
    return pool().maxParallel;
  },
  probeHealth: () => pool().probeHealth(),
};

/** Worker count for voice batch jobs — overlaps prep I/O with the next TTS slot. */
export const ttsPipelineConcurrency = (): number => ttsPool.maxParallel + 1;
