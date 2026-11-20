/**
 * One import job of a Vortex run. Two machines of a group may hold the same
 * folder, so two runs can name the same job: the second waits for the first
 * and takes its result instead of failing on "already running".
 */
import type { Tx } from '../../../../src/db';
import { getModImportJob } from '../../../../src/import/mod/jobs';
import { isModImportRunning } from '../../../../src/import/mod/run/activeJobs';
import { runModImport } from '../../../../src/import/mod/run/runImport';
import type { ModImportJob } from '../../../../src/import/mod/types';

export type ImportOrAwaitDeps = {
  get: (db: Tx, jobId: number) => Promise<ModImportJob | undefined | null>;
  run: (db: Tx, job: ModImportJob) => Promise<ModImportJob>;
  isRunning: (jobId: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  /** Called before the job is imported here (not when it was complete already). */
  onStart?: (job: ModImportJob) => void;
};

const defaults: ImportOrAwaitDeps = {
  get: getModImportJob,
  run: runModImport,
  isRunning: isModImportRunning,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const ALREADY_RUNNING = /is already running$/;

/**
 * The job, imported: by this call, by an earlier try, or by the run that was
 * importing it meanwhile. Null when the job is gone.
 */
export const importOrAwait = async (
  db: Tx,
  jobId: number,
  overrides: Partial<ImportOrAwaitDeps> = {},
  pollMs = 2000,
): Promise<ModImportJob | null> => {
  const deps = { ...defaults, ...overrides };
  for (;;) {
    while (deps.isRunning(jobId)) await deps.sleep(pollMs);
    const job = await deps.get(db, jobId);
    if (!job) return null;
    if (job.status === 'completed' && job.mod_id) return job;
    try {
      deps.onStart?.(job);
      return await deps.run(db, job);
    } catch (err) {
      // Another run took the job between the check and the start: wait for it.
      const message = err instanceof Error ? err.message : String(err);
      if (!ALREADY_RUNNING.test(message)) throw err;
    }
  }
};
