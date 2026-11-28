/**
 * Finished vocal effort analyses waiting to be read on the Mods page.
 *
 * Filled from the job's own stream and, for a job this tab did not start (or
 * one a worker restart queued again under a new id), from the active-jobs
 * poll. A job's result is shown once, however many of those report it.
 */
import { useSyncExternalStore } from 'react';
import type { VoiceEffortResult } from './api';

export type VoiceEffortResultEntry = { jobId: number; result: VoiceEffortResult };

let pending: VoiceEffortResultEntry[] = [];
const reported = new Set<number>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const reportVoiceEffortResult = (entry: VoiceEffortResultEntry): void => {
  if (reported.has(entry.jobId)) return;
  reported.add(entry.jobId);
  pending = [...pending, entry];
  emit();
};

export const dismissVoiceEffortResult = (jobId: number): void => {
  const next = pending.filter((entry) => entry.jobId !== jobId);
  if (next.length === pending.length) return;
  pending = next;
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The oldest result nobody has closed yet, or null. */
export const useNextVoiceEffortResult = (): VoiceEffortResultEntry | null =>
  useSyncExternalStore(subscribe, () => pending[0] ?? null);
