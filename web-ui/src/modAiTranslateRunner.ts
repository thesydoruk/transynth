import { api } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const handleTranslateEvent = (
  modId: number,
  translateMode: 'tm' | 'llm',
  event: { type: string; jobId?: number; total?: number; done?: number; error?: string },
): void => {
  if (event.type === 'started' && event.jobId != null && event.total != null) {
    jobIdByMod.set(modId, event.jobId);
    upsertModAiJob(modId, 'translate', {
      status: 'running',
      jobId: event.jobId,
      translateMode,
      total: event.total,
      done: 0,
      error: null,
    });
  }
  if (event.type === 'progress' && event.done != null && event.total != null) {
    upsertModAiJob(modId, 'translate', {
      status: 'running',
      translateMode,
      done: event.done,
      total: event.total,
    });
  }
  if (event.type === 'done' && event.done != null && event.total != null) {
    upsertModAiJob(modId, 'translate', {
      status: 'completed',
      translateMode,
      done: event.done,
      total: event.total,
      error: null,
    });
  }
  if (event.type === 'cancelled' && event.done != null && event.total != null) {
    upsertModAiJob(modId, 'translate', {
      status: 'cancelled',
      translateMode,
      done: event.done,
      total: event.total,
    });
  }
  if (event.type === 'error') {
    upsertModAiJob(modId, 'translate', {
      status: 'failed',
      translateMode,
      error: event.error ?? 'Unknown error',
    });
  }
};

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
    translateMode: 'llm',
    jobId: null,
    done: 0,
    total: 0,
    error: null,
  });

  try {
    const snapshot = await api.llmTranslate.start(modId, srcLang, targetLang, (event) => {
      handleTranslateEvent(modId, 'llm', event);
    });

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'translate', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        translateMode: 'llm',
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
    }
  } catch (err) {
    upsertModAiJob(modId, 'translate', {
      status: 'failed',
      translateMode: 'llm',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

/** Start mod-wide TM apply and stream progress into the shared translate job slot. */
export const startModAiTranslateTm = async (
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<void> => {
  if (inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  upsertModAiJob(modId, 'translate', {
    status: 'running',
    translateMode: 'tm',
    jobId: null,
    done: 0,
    total: 0,
    error: null,
  });

  try {
    const snapshot = await api.tmApply.start(modId, srcLang, targetLang, (event) => {
      handleTranslateEvent(modId, 'tm', event);
    });

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'translate', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        translateMode: 'tm',
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
    }
  } catch (err) {
    upsertModAiJob(modId, 'translate', {
      status: 'failed',
      translateMode: 'tm',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

/** Request stop for a running mod-wide translation job (TM or LLM). */
export const stopModAiTranslate = async (
  modId: number,
  entry: ModAiJobEntry = getModAiJob(modId, 'translate'),
): Promise<void> => {
  const resolvedJobId = entry.jobId ?? jobIdByMod.get(modId) ?? null;

  upsertModAiJob(modId, 'translate', { status: 'stopping', error: null });

  try {
    if (entry.translateMode === 'tm') {
      if (resolvedJobId != null) {
        await api.tmApply.stop(resolvedJobId);
      } else {
        await api.tmApply.stopMod(modId);
      }
      return;
    }

    if (resolvedJobId == null) return;
    await api.llmTranslate.stop(resolvedJobId);
  } catch (err) {
    upsertModAiJob(modId, 'translate', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Start or stop mod-wide LLM translation based on the current job entry. */
export const toggleModAiTranslate = (
  modId: number,
  srcLang: string,
  targetLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'translate'),
): void => {
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (isRunning) {
    void stopModAiTranslate(modId, entry);
    return;
  }
  void startModAiTranslate(modId, srcLang, targetLang);
};

/** Start or stop mod-wide TM apply based on the current job entry. */
export const toggleModAiTranslateTm = (
  modId: number,
  srcLang: string,
  targetLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'translate'),
): void => {
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (isRunning) {
    void stopModAiTranslate(modId, entry);
    return;
  }
  void startModAiTranslateTm(modId, srcLang, targetLang);
};
