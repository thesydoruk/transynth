/**
 * In-memory app-level queue for long-running operations that do not yet have
 * a dedicated backend jobs table.
 *
 * Used to surface cross-page progress in overview surfaces (Home / future
 * Job Center), for example:
 * - LLM batch translation started from Mod Editor
 * - Export operations started from Imports page
 */

export type AppJobKind = 'llm' | 'export';

export type AppJobStatus = 'running' | 'completed' | 'failed';

export type AppJob = {
  id: string;
  kind: AppJobKind;
  label: string;
  status: AppJobStatus;
  progress: number | null;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

type Listener = () => void;

let jobs: AppJob[] = [];
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Returns app jobs sorted newest-first by update timestamp. */
export const listAppJobs = (): AppJob[] =>
  [...jobs].sort((a, b) => b.updatedAt - a.updatedAt);

/** Subscribes to app-job queue updates. */
export const subscribeAppJobs = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Inserts or replaces a job by ID and notifies subscribers. */
export const upsertAppJob = (job: AppJob) => {
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  emit();
};

/** Removes a job by ID and notifies subscribers. */
export const removeAppJob = (id: string) => {
  const before = jobs.length;
  jobs = jobs.filter((j) => j.id !== id);
  if (jobs.length !== before) emit();
};
