import type { Tx } from '../../../../src/db';
import { logTranslate } from '../../../../src/logging/loggers';
import { loadModImportPaths } from '../../../../src/import/mod/resolvePaths';
import { resolveImportPackages } from '../../../../src/modImport';
import type { ModStressPlaceScope } from '../../../../src/web/data/queries/stressPlacement';
import { countStressPlaceWork } from '../../../../src/web/data/queries/stressPlacement';
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
    /** @deprecated Ignored — never wipe existing stresses; use scope=all to recompute. */
    force?: boolean;
    isCancelled: () => boolean;
    signal: AbortSignal;
  },
  onEvent: (event: LlmStressPlaceProgressEvent) => void,
): Promise<LlmStressPlaceJobSnapshot> => {
  const { jobId, modId } = opts;
  // Treat legacy force as scope=all without clearing text_stressed first.
  const scope: ModStressPlaceScope = opts.force === true ? 'all' : (opts.scope ?? 'missing');
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

    if (opts.force === true) {
      logTranslate.info('stress-place force ignored (no wipe); using scope=all', { modId });
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
        scope,
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
