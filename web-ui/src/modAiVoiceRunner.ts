import { api, type ModVoiceGenerateScope } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

/** Start mod-wide voice synthesis and stream progress into the shared job store. */
export const startModAiVoice = async (
  modId: number,
  srcLang: string,
  targetLang: string,
  scope: ModVoiceGenerateScope = 'all',
): Promise<void> => {
  if (inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  upsertModAiJob(modId, 'voice', {
    status: 'running',
    jobId: null,
    done: 0,
    total: 0,
    error: null,
  });

  try {
    const snapshot = await api.voiceGenerate.start(
      modId,
      srcLang,
      targetLang,
      (event) => {
        if (event.type === 'started') {
          jobIdByMod.set(modId, event.jobId);
          upsertModAiJob(modId, 'voice', {
            status: 'running',
            jobId: event.jobId,
            total: event.total,
            done: 0,
            error: null,
          });
        }
        if (event.type === 'progress') {
          upsertModAiJob(modId, 'voice', {
            status: 'running',
            done: event.done,
            total: event.total,
          });
        }
        if (event.type === 'done') {
          upsertModAiJob(modId, 'voice', {
            status: 'completed',
            done: event.done,
            total: event.total,
            error: null,
          });
        }
        if (event.type === 'cancelled') {
          upsertModAiJob(modId, 'voice', {
            status: 'cancelled',
            done: event.done,
            total: event.total,
          });
        }
      },
      undefined,
      scope,
    );

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'voice', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
    }
  } catch (err) {
    upsertModAiJob(modId, 'voice', {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
  }
};

/** Request stop for a running voice generation job. */
export const stopModAiVoice = async (modId: number, jobId: number | null): Promise<void> => {
  const resolvedJobId = jobId ?? jobIdByMod.get(modId) ?? null;

  upsertModAiJob(modId, 'voice', { status: 'stopping', error: null });

  try {
    if (resolvedJobId != null) {
      await api.voiceGenerate.stop(resolvedJobId);
    } else {
      await api.voiceGenerate.stopMod(modId);
    }
  } catch (err) {
    upsertModAiJob(modId, 'voice', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Start voice generation (with scope) or stop if already running. */
export const toggleModAiVoice = (
  modId: number,
  srcLang: string,
  targetLang: string,
  entry: ModAiJobEntry = getModAiJob(modId, 'voice'),
  scope: ModVoiceGenerateScope = 'all',
): void => {
  const isRunning = entry.status === 'running' || entry.status === 'stopping';
  if (isRunning) {
    void stopModAiVoice(modId, entry.jobId);
    return;
  }
  void startModAiVoice(modId, srcLang, targetLang, scope);
};
