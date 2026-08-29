/**
 * In-memory queue for Nexus file downloads that are in progress before
 * a mod import job is registered on the backend.
 */

export type NexusDownloadStatus = 'downloading' | 'failed';

export type NexusDownloadJob = {
  id: string;
  gameId: string;
  modId: number;
  fileId: number;
  fileName: string;
  status: NexusDownloadStatus;
  progress: number;
  createdAt: number;
  error?: string;
};

type Listener = () => void;

let jobs: NexusDownloadJob[] = [];
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const subscribeNexusDownloadJobs = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const listNexusDownloadJobs = (): NexusDownloadJob[] =>
  [...jobs].sort((a, b) => b.createdAt - a.createdAt);

export const upsertNexusDownloadJob = (job: NexusDownloadJob) => {
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  emit();
};

export const patchNexusDownloadJob = (id: string, patch: Partial<NexusDownloadJob>) => {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], ...patch };
  emit();
};

export const removeNexusDownloadJob = (id: string) => {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
};
