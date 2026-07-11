import { api } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

/** Start mod-wide LLM translation and stream progress into the shared job store. */
export const startModAiTranslate = async (
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<void> => {
  if (inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  upsertModAiJob(modId, 'translate', {
    status: 'running',
    jobId: null,
    done: 0,
    total: 0,
    error: null,
  });

  try {
    const snapshot = await api.llmTranslate.start(modId, srcLang, targetLang, (event) => {
      if (event.type === 'started') {
        jobIdByMod.set(modId, event.jobId);
        upsertModAiJob(modId, 'translate', {
          status: 'running',
          jobId: event.jobId,
          total: event.total,
          done: 0,
          error: null,
        });
      }
      if (event.type === 'progress') {
        upsertModAiJob(modId, 'translate', {
          status: 'running',
          done: event.done,
          total: event.total,
        });
      }
      if (event.type === 'done') {
        upsertModAiJob(modId, 'translate', {
          status: 'completed',
          done: event.done,
          total: event.total,
          error: null,
        });
      }
      if (event.type === 'cancelled') {
        upsertModAiJob(modId, 'translate', {
          status: 'cancelled',
          done: event.done,
          total: event.total,
        });
      }
    });

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'translate', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
    }
  } catch (err) {
    upsertModAiJob(modId, 'translate', {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

/** Request stop for a running mod-wide translation job. */
export const stopModAiTranslate = async (modId: number, jobId: number | null): Promise<void> => {
  const resolvedJobId = jobId ?? jobIdByMod.get(modId) ?? null;
  if (resolvedJobId == null) return;

  upsertModAiJob(modId, 'translate', { status: 'stopping', error: null });

  try {
    await api.llmTranslate.stop(resolvedJobId);
  } catch (err) {
    upsertModAiJob(modId, 'translate', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Start or stop mod-wide translation based on the current job entry. */
export const toggleModAiTranslate = (
  modId: number,
  srcLang: string,
  targetLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'translate'),
): void => {
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (isRunning) {
    void stopModAiTranslate(modId, entry.jobId);
    return;
  }
  void startModAiTranslate(modId, srcLang, targetLang);
};
