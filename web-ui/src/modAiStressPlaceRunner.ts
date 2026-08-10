import { api, type ModStressPlaceScope } from './api';
import { finalizeModAiJobStop, isModAiJobActive } from './modAiJobStop';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const shouldForceRescan = (entry: ModAiJobEntry): boolean =>
  entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'failed';

const isStressAlreadyRunningError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  return err.message.includes('already running') || err.message.includes('HTTP 409');
};

const syncRunningStressPlaceFromServer = async (
  modId: number,
  speakerKey: string | null,
): Promise<boolean> => {
  const active = await api.modAiJobs.listActive();
  const existing = active.find((job) => job.modId === modId && job.kind === 'stress-place');
  if (!existing) return false;

  upsertModAiJob(modId, 'stress-place', {
    status: 'running',
    jobId: existing.jobId,
    done: existing.done,
    total: existing.total,
    speakerKey: existing.speakerKey ?? speakerKey,
    error: null,
  });
  return true;
};

/** Start mod-wide or character-scoped Ukrainian stress placement. */
export const startModAiStressPlace = async (
  modId: number,
  srcLang: string,
  targetLang: string,
  scope: ModStressPlaceScope = 'missing',
  speakerKey?: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'stress-place'),
): Promise<void> => {
  const scopedSpeaker = speakerKey?.trim() || null;
  if (isModAiJobActive(entry)) return;
  if (inFlight.has(modId)) return;

  inFlight.add(modId);
  jobIdByMod.delete(modId);

  try {
    if (await syncRunningStressPlaceFromServer(modId, scopedSpeaker)) return;

    upsertModAiJob(modId, 'stress-place', {
      status: 'running',
      jobId: null,
      done: 0,
      total: 0,
      speakerKey: scopedSpeaker,
      error: null,
    });

    const snapshot = await api.llmStressPlace.start(modId, srcLang, targetLang, {
      scope,
      speakerKey: scopedSpeaker ?? undefined,
      force: shouldForceRescan(entry),
      onEvent: (event) => {
        if (event.type === 'started') {
          jobIdByMod.set(modId, event.jobId);
          upsertModAiJob(modId, 'stress-place', {
            status: 'running',
            jobId: event.jobId,
            total: event.total,
            done: 0,
            speakerKey: scopedSpeaker,
            error: null,
          });
        }
        if (event.type === 'progress') {
          upsertModAiJob(modId, 'stress-place', {
            status: 'running',
            done: event.done,
            total: event.total,
            speakerKey: scopedSpeaker,
          });
        }
        if (event.type === 'done') {
          upsertModAiJob(modId, 'stress-place', {
            status: 'completed',
            done: event.done,
            total: event.total,
            speakerKey: scopedSpeaker,
            error: null,
          });
        }
        if (event.type === 'cancelled') {
          upsertModAiJob(modId, 'stress-place', {
            status: 'cancelled',
            done: event.done,
            total: event.total,
            speakerKey: scopedSpeaker,
          });
        }
        if (event.type === 'error') {
          upsertModAiJob(modId, 'stress-place', {
            status: 'failed',
            error: event.error,
            speakerKey: scopedSpeaker,
          });
        }
      },
    });

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'stress-place', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        speakerKey: scopedSpeaker,
        error: snapshot.error,
      });
    }
  } catch (err) {
    if (
      isStressAlreadyRunningError(err) &&
      (await syncRunningStressPlaceFromServer(modId, scopedSpeaker))
    ) {
      return;
    }
    upsertModAiJob(modId, 'stress-place', {
      status: 'failed',
      speakerKey: scopedSpeaker,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

export const stopModAiStressPlace = async (
  modId: number,
  jobId: number | null,
  speakerKey?: string | null,
): Promise<void> => {
  const resolvedJobId = jobId ?? jobIdByMod.get(modId) ?? null;
  const keepSpeaker = speakerKey ?? getModAiJob(modId, 'stress-place').speakerKey ?? null;

  upsertModAiJob(modId, 'stress-place', {
    status: 'stopping',
    error: null,
    speakerKey: keepSpeaker,
  });

  try {
    if (resolvedJobId != null) {
      await api.llmStressPlace.stop(resolvedJobId);
    } else {
      await api.llmStressPlace.stopMod(modId);
    }
  } catch {
    /* queue row may already be gone — reconcile from snapshot below */
  } finally {
    await finalizeModAiJobStop(modId, 'stress-place', resolvedJobId, keepSpeaker);
  }
};

export const toggleModAiStressPlace = (
  modId: number,
  srcLang: string,
  targetLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'stress-place'),
  scope: ModStressPlaceScope = 'missing',
  speakerKey?: string,
): void => {
  if (isModAiJobActive(entry)) {
    void stopModAiStressPlace(modId, entry.jobId, entry.speakerKey);
    return;
  }
  void startModAiStressPlace(modId, srcLang, targetLang, scope, speakerKey, entry);
};
