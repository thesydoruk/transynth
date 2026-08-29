/**
 * Cooperative cancel/pause flags for running mod imports, keyed by
 * `mod_imports.id`.
 *
 * Process-local by design: only the worker runs import loops, and the handler
 * flips these flags when BullMQ delivers an abort or pause on the control
 * channel.
 */
interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export const beginActiveImport = (jobId: number): ActiveImport => {
  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(jobId, state);
  return state;
};

export const endActiveImport = (jobId: number): void => {
  activeImports.delete(jobId);
};

/**
 * Return true if this job id currently has a running import loop.
 */
export const isModImportRunning = (jobId: number): boolean => {
  const state = activeImports.get(jobId);
  return !!state && !state.cancel && !state.pause;
};

/**
 * Request cancellation of a running import.
 *
 * Cancellation is cooperative: the import loop checks this flag between record
 * writes and will mark the job as failed with a cancellation reason.
 */
export const requestModCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
};

/**
 * Request pausing of a running import.
 *
 * Pausing is cooperative: the import loop checks this flag between record
 * writes and will commit progress and mark the job as paused.
 */
export const requestModPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
};
