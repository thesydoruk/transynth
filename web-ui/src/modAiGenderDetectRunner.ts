import { api } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const shouldForceRescan = (entry: ModAiJobEntry): boolean =>
  entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'failed';

/** Start mod-wide narrator gender detection. */
export const startModAiGenderDetect = async (
  modId: number,
  srcLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'gender-detect'),
): Promise<void> => {
  if (inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  upsertModAiJob(modId, 'gender-detect', {
    status: 'running',
    jobId: null,
    done: 0,
    total: 0,
    error: null,
  });

  try {
    const snapshot = await api.llmGenderDetect.start(modId, srcLang, {
      force: shouldForceRescan(entry),
      useLlm: true,
      onEvent: (event) => {
        if (event.type === 'started') {
          jobIdByMod.set(modId, event.jobId);
          upsertModAiJob(modId, 'gender-detect', {
            status: 'running',
            jobId: event.jobId,
            total: event.total,
            done: 0,
            error: null,
          });
        }
        if (event.type === 'progress') {
          upsertModAiJob(modId, 'gender-detect', {
            status: 'running',
            done: event.done,
            total: event.total,
          });
        }
        if (event.type === 'done') {
          upsertModAiJob(modId, 'gender-detect', {
            status: 'completed',
            done: event.done,
            total: event.total,
            error: null,
          });
        }
        if (event.type === 'cancelled') {
          upsertModAiJob(modId, 'gender-detect', {
            status: 'cancelled',
            done: event.done,
            total: event.total,
          });
        }
        if (event.type === 'error') {
          upsertModAiJob(modId, 'gender-detect', {
            status: 'failed',
            error: event.error,
          });
        }
      },
    });

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'gender-detect', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
    }
  } catch (err) {
    upsertModAiJob(modId, 'gender-detect', {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

export const stopModAiGenderDetect = async (modId: number, jobId: number | null): Promise<void> => {
  const resolvedJobId = jobId ?? jobIdByMod.get(modId) ?? null;

  upsertModAiJob(modId, 'gender-detect', { status: 'stopping', error: null });

  try {
    if (resolvedJobId != null) {
      await api.llmGenderDetect.stop(resolvedJobId);
    } else {
      await api.llmGenderDetect.stopMod(modId);
    }
    upsertModAiJob(modId, 'gender-detect', { status: 'cancelled', error: null });
  } catch (err) {
    upsertModAiJob(modId, 'gender-detect', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export const toggleModAiGenderDetect = (
  modId: number,
  srcLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'gender-detect'),
): void => {
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (isRunning) {
    void stopModAiGenderDetect(modId, entry.jobId);
    return;
  }
  void startModAiGenderDetect(modId, srcLang, entry);
};
