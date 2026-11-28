/**
 * The slow half of the vocal effort analysis: decode and measure takes, saving
 * as it goes.
 *
 * A base game has over a hundred thousand takes and a deploy kills a running
 * job in under a second, so the features are written chunk by chunk: a killed
 * run loses at most the chunk it was in, and the next run skips every take
 * that already has a row. Stopping is checked before each take is claimed;
 * takes already being decoded finish and are saved.
 */
import { mapWithConcurrency } from '../utils/concurrency';
import type { EffortFeatures } from './vocalEffort';

export type MeasuredTake<T> = { key: string; take: T; features: EffortFeatures | null };

export type MeasureTakesOptions<T> = {
  /** Takes still to measure, by their stamp key. */
  pending: ReadonlyArray<readonly [string, T]>;
  /** Null when the take holds too little speech to measure; a throw counts it as failed. */
  measure: (take: T, index: number) => Promise<EffortFeatures | null>;
  /** Persist one chunk; the next chunk starts only after it resolves. */
  save: (chunk: ReadonlyArray<MeasuredTake<T>>) => Promise<void>;
  workers: number;
  chunkSize: number;
  /** After every take, with the number of takes this run has handled (measured or failed). */
  onTake?: (handled: number) => void;
  shouldCancel?: () => boolean;
};

export type MeasureTakesResult = {
  features: Map<string, EffortFeatures | null>;
  measured: number;
  /** Takes that could not be decoded; they get no row, so the next run tries them again. */
  failed: number;
  /** True when a stop left takes unhandled. */
  cancelled: boolean;
};

export const measureTakesInChunks = async <T>(
  options: MeasureTakesOptions<T>,
): Promise<MeasureTakesResult> => {
  const { pending, measure, save, onTake } = options;
  const stopped = (): boolean => options.shouldCancel?.() ?? false;
  const chunkSize = Math.max(1, Math.floor(options.chunkSize));
  const features = new Map<string, EffortFeatures | null>();
  let measured = 0;
  let failed = 0;

  for (let start = 0; start < pending.length && !stopped(); start += chunkSize) {
    const chunk = pending.slice(start, start + chunkSize);
    const done: MeasuredTake<T>[] = [];
    await mapWithConcurrency(
      chunk,
      Math.max(1, options.workers),
      async ([key, take], i) => {
        try {
          done.push({ key, take, features: await measure(take, start + i) });
          measured += 1;
        } catch {
          failed += 1;
        }
        onTake?.(measured + failed);
      },
      { shouldAbort: stopped },
    );
    // Saved even when a stop cut the chunk short: those takes are decoded already.
    if (done.length > 0) await save(done);
    for (const item of done) features.set(item.key, item.features);
  }

  return { features, measured, failed, cancelled: measured + failed < pending.length };
};
