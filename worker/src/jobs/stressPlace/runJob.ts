import type { Tx } from '../../../../src/db';
import { logTranslate } from '../../../../src/logging/loggers';
import { loadModImportPaths } from '../../../../src/import/mod/resolvePaths';
import { resolveImportPackages } from '../../../../src/modImport';
import type { ModStressPlaceScope } from '../../../../src/web/data/queries/stressPlacement';
import {
  countStressPlaceWork,
  resetModStressPlaceState,
} from '../../../../src/web/data/queries/stressPlacement';
import { runModStressPlacePipeline } from './pipeline/runPipeline';
import type {
  LlmStressPlaceJobSnapshot,
  LlmStressPlaceJobStatus,
  LlmStressPlaceProgressEvent,
} from './types';

export const runLlmStressPlaceJob = async (
  db: Tx,
  opts: {
    jobId: number;
    modId: number;
    srcLang: string;
    targetLang: string;
    scope?: ModStressPlaceScope;
    speakerKey?: string;
    force?: boolean;
    isCancelled: () => boolean;
    signal: AbortSignal;
  },
  onEvent: (event: LlmStressPlaceProgressEvent) => void,
): Promise<LlmStressPlaceJobSnapshot> => {
  const { jobId, modId } = opts;
  const scope = opts.scope ?? 'missing';
  let force = opts.force === true;
  let done = 0;
  let total = 0;
  let placedCount = 0;
  let status: LlmStressPlaceJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): LlmStressPlaceJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    placedCount,
    error,
  });

  try {
    const speakerKey = opts.speakerKey?.trim() || undefined;
    const paths = await loadModImportPaths(db, { modId });
    const packages = resolveImportPackages(paths.extractDir, opts.targetLang, paths.pluginPath);

    if (force) {
      const reset = await resetModStressPlaceState(db, modId, opts.targetLang);
      logTranslate.info('stress-place force reset', { modId, reset });
    }

    total = await countStressPlaceWork(
      db,
      modId,
      packages,
      opts.srcLang,
      opts.targetLang,
      scope,
      speakerKey,
    );
    if (total === 0 && !force && scope === 'missing') {
      force = true;
      total = await countStressPlaceWork(
        db,
        modId,
        packages,
        opts.srcLang,
        opts.targetLang,
        'all',
        speakerKey,
      );
      if (total > 0) {
        await resetModStressPlaceState(db, modId, opts.targetLang);
      }
    }
    if (total === 0) {
      throw new Error(
        speakerKey
          ? `No voiced lines need stress placement for ${speakerKey}`
          : 'No voiced lines need stress placement',
      );
    }

    onEvent({ type: 'started', jobId, total });

    const summary = await runModStressPlacePipeline(
      db,
      {
        modId,
        packages,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        scope: force ? 'all' : scope,
        speakerKey,
        knownTotal: total,
        shouldCancel: opts.isCancelled,
        signal: opts.signal,
      },
      {
        onProgress: (d, placed) => {
          done = d;
          placedCount = placed;
          onEvent({ type: 'progress', done, total });
        },
      },
    );

    done = summary.done;
    placedCount = summary.placedCount;

    if (opts.isCancelled()) {
      status = 'cancelled';
      onEvent({ type: 'cancelled', done, total, placedCount });
    } else {
      status = 'completed';
      onEvent({ type: 'done', done, total, placedCount });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    status = 'failed';
    logTranslate.error('stress-place job failed', { jobId, error });
    onEvent({ type: 'error', error });
  }

  return snapshot();
};
