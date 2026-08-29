import { api } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const shouldForceRescan = (entry: ModAiJobEntry): boolean =>
  entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'failed';

/** Start mod-wide skip-detect and stream progress into the shared job store. */
export const startModAiSkipDetect = async (
  modId: number,
  srcLang: string,
  useLlm: boolean,
  entry: ModAiJobEntry = getModAiJob(modId, 'skip-detect'),
): Promise<void> => {
  if (inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  upsertModAiJob(modId, 'skip-detect', {
    status: 'running',
    jobId: null,
    done: 0,
    total: 0,
    error: null,
  });

  try {
    const snapshot = await api.llmSkipDetect.start(modId, srcLang, {
      force: shouldForceRescan(entry),
      useLlm,
      persist: true,
      onEvent: (event) => {
        if (event.type === 'started') {
          jobIdByMod.set(modId, event.jobId);
          upsertModAiJob(modId, 'skip-detect', {
            status: 'running',
            jobId: event.jobId,
            total: event.total,
            done: 0,
            error: null,
          });
        }
        if (event.type === 'progress') {
          upsertModAiJob(modId, 'skip-detect', {
            status: 'running',
            done: event.done,
            total: event.total,
          });
        }
        if (event.type === 'done') {
          upsertModAiJob(modId, 'skip-detect', {
            status: 'completed',
            done: event.done,
            total: event.total,
            error: null,
          });
        }
        if (event.type === 'cancelled') {
          upsertModAiJob(modId, 'skip-detect', {
            status: 'cancelled',
            done: event.done,
            total: event.total,
          });
        }
        if (event.type === 'error') {
          upsertModAiJob(modId, 'skip-detect', {
            status: 'failed',
            error: event.error,
          });
        }
      },
    });

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'skip-detect', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
    }
  } catch (err) {
    upsertModAiJob(modId, 'skip-detect', {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

/** Request stop for a running skip-detect job. */
export const stopModAiSkipDetect = async (modId: number, jobId: number | null): Promise<void> => {
  const resolvedJobId = jobId ?? jobIdByMod.get(modId) ?? null;

  upsertModAiJob(modId, 'skip-detect', { status: 'stopping', error: null });

  try {
    if (resolvedJobId != null) {
      await api.llmSkipDetect.stop(resolvedJobId);
    } else {
      await api.llmSkipDetect.stopMod(modId);
    }
    upsertModAiJob(modId, 'skip-detect', { status: 'cancelled', error: null });
  } catch (err) {
    upsertModAiJob(modId, 'skip-detect', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Stop a running skip-detect job when one is active. */
export const toggleModAiSkipDetect = (
  modId: number,
  entry: ModAiJobEntry = getModAiJob(modId, 'skip-detect'),
): void => {
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (!isRunning) return;
  void stopModAiSkipDetect(modId, entry.jobId);
};
