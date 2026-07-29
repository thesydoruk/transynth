/**
 * Mod-wide voice synthesis job body (Fish Speech → localized `.fuz`).
 */
import type { Tx } from '../../../../src/db';
import { log } from '../../../../src/logger';
import {
  countVoiceLocalizeWork,
  localizeModImportVoice,
  type ModVoiceGenerateScope,
} from '../../../../src/voice';
import { resolveImportPackages } from '../../../../src/modImport';
import { loadModImportPaths } from '../../../../src/import/mod/resolvePaths';

export type ModVoiceGenerateJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type ModVoiceGenerateJobSnapshot = {
  jobId: number;
  modId: number;
  status: ModVoiceGenerateJobStatus;
  done: number;
  total: number;
  written: number;
  skipped: number;
  warningCount: number;
  error: string | null;
};

export type ModVoiceGenerateProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done';
      done: number;
      total: number;
      written: number;
      skipped: number;
      warningCount: number;
    }
  | { type: 'cancelled'; done: number; total: number }
  | { type: 'error'; error: string };

export const runModVoiceGenerateJob = async (
  db: Tx,
  opts: {
    jobId: number;
    modId: number;
    srcLang: string;
    targetLang: string;
    game: string;
    modName?: string | null;
    scope?: ModVoiceGenerateScope;
    isCancelled: () => boolean;
  },
  onEvent: (event: ModVoiceGenerateProgressEvent) => void,
): Promise<ModVoiceGenerateJobSnapshot> => {
  const { jobId, modId } = opts;
  const paths = await loadModImportPaths(db, { modId });
  const packages = resolveImportPackages(paths.extractDir, opts.targetLang, paths.pluginPath);
  const scope = opts.scope ?? 'missing';
  let total = await countVoiceLocalizeWork(
    db,
    modId,
    packages,
    opts.srcLang,
    opts.targetLang,
    scope,
  );
  if (total === 0) {
    throw new Error(
      scope === 'missing'
        ? 'No missing or stale voice lines to synthesize'
        : 'No voiced lines with translations to synthesize',
    );
  }

  let done = 0;
  let written = 0;
  let skipped = 0;
  let warningCount = 0;
  let status: ModVoiceGenerateJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): ModVoiceGenerateJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    written,
    skipped,
    warningCount,
    error,
  });

  log.info(
    `[Voice generate mod #${modId}] job #${jobId} started (${total} lines, scope=${scope}, ${opts.srcLang}→${opts.targetLang})`,
  );
  onEvent({ type: 'started', jobId, total });

  try {
    const result = await localizeModImportVoice(db, {
      extractDir: paths.extractDir,
      pluginPath: paths.pluginPath,
      modId,
      srcLang: opts.srcLang,
      tgtLang: opts.targetLang,
      shouldCancel: opts.isCancelled,
      scope,
      onProgress: (d, progressTotal) => {
        done = d;
        total = progressTotal;
        onEvent({ type: 'progress', done, total: progressTotal });
      },
    });

    written = result.written.length;
    skipped = result.skipped.length;
    warningCount = result.warnings.length;

    if (opts.isCancelled()) {
      status = 'cancelled';
      log.info(`[Voice generate mod #${modId}] job #${jobId} cancelled`, { done, total });
      onEvent({ type: 'cancelled', done, total });
    } else {
      status = 'completed';
      log.info(`[Voice generate mod #${modId}] job #${jobId} completed`, {
        done,
        total,
        written,
        skipped,
        warnings: warningCount,
      });
      onEvent({ type: 'done', done, total, written, skipped, warningCount });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = 'failed';
    error = message;
    log.error(`[Voice generate mod #${modId}] job #${jobId} failed: ${message}`);
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};
