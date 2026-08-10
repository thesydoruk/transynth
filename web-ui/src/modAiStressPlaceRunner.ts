import { api, type ModStressPlaceScope } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const shouldForceRescan = (entry: ModAiJobEntry): boolean =>
  entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'failed';

/** Start mod-wide or character-scoped Ukrainian stress placement. */
export const startModAiStressPlace = async (
  modId: number,
  srcLang: string,
  targetLang: string,
  scope: ModStressPlaceScope = 'missing',
  speakerKey?: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'stress-place'),
): Promise<void> => {
  if (inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  const scopedSpeaker = speakerKey?.trim() || null;
  upsertModAiJob(modId, 'stress-place', {
    status: 'running',
    jobId: null,
    done: 0,
    total: 0,
    speakerKey: scopedSpeaker,
    error: null,
  });

  try {
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

export const stopModAiStressPlace = async (modId: number, jobId: number | null): Promise<void> => {
  const resolvedJobId = jobId ?? jobIdByMod.get(modId) ?? null;
  upsertModAiJob(modId, 'stress-place', { status: 'stopping', error: null });
  try {
    if (resolvedJobId != null) await api.llmStressPlace.stop(resolvedJobId);
    else await api.llmStressPlace.stopMod(modId);
    upsertModAiJob(modId, 'stress-place', { status: 'cancelled', error: null });
  } catch (err) {
    upsertModAiJob(modId, 'stress-place', {
      error: err instanceof Error ? err.message : String(err),
    });
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
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (isRunning) {
    void stopModAiStressPlace(modId, entry.jobId);
    return;
  }
  void startModAiStressPlace(modId, srcLang, targetLang, scope, speakerKey, entry);
};
