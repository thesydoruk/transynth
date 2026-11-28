/**
 * Start and stop the vocal effort analysis of a mod (`voice-effort` job).
 *
 * Progress goes to the shared mod job store, where the voice slot of the mod's
 * AI controls shows it; the finished result goes to `voiceEffortResults`.
 */
import { api } from './api';
import { clearModAiJob, getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';
import { reportVoiceEffortResult } from './voiceEffortResults';

const KIND = 'voice-effort';
/** How long a finished run keeps the voice slot before it shows synthesis again. */
const FINISHED_TTL_MS = 20_000;

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const isActive = (entry: ModAiJobEntry): boolean =>
  entry.status === 'running' || entry.status === 'stopping';

const isStopHeld = (modId: number): boolean => {
  const status = getModAiJob(modId, KIND).status;
  return status === 'stopping' || status === 'cancelled';
};

const clearWhenIdle = (modId: number) => {
  window.setTimeout(() => {
    if (!isActive(getModAiJob(modId, KIND))) clearModAiJob(modId, KIND);
  }, FINISHED_TTL_MS);
};

/** Attach to an analysis of this mod already running on the server (another tab). */
const attachToRunning = async (modId: number): Promise<boolean> => {
  const active = await api.modAiJobs.listActive();
  const existing = active.find((job) => job.modId === modId && job.kind === KIND);
  if (!existing) return false;
  upsertModAiJob(modId, KIND, {
    status: 'running',
    jobId: existing.jobId,
    done: existing.done,
    total: existing.total,
    error: null,
  });
  return true;
};

export const startModVoiceEffort = async (modId: number): Promise<void> => {
  if (isActive(getModAiJob(modId, KIND)) || inFlight.has(modId)) return;
  inFlight.add(modId);
  jobIdByMod.delete(modId);
  upsertModAiJob(modId, KIND, { status: 'running', jobId: null, done: 0, total: 0, error: null });

  try {
    const snapshot = await api.voiceEffortAnalysis.start(modId, (event) => {
      if (event.type === 'started') {
        jobIdByMod.set(modId, event.jobId);
        upsertModAiJob(modId, KIND, {
          status: isStopHeld(modId) ? 'stopping' : 'running',
          jobId: event.jobId,
          done: 0,
          total: event.total,
        });
      }
      if (event.type === 'progress') {
        upsertModAiJob(modId, KIND, {
          status: isStopHeld(modId) ? getModAiJob(modId, KIND).status : 'running',
          done: event.done,
          total: event.total,
        });
      }
    });
    if (snapshot) {
      upsertModAiJob(modId, KIND, {
        status: snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        error: snapshot.error,
      });
      if (snapshot.status === 'completed' && snapshot.result) {
        reportVoiceEffortResult({ jobId: snapshot.jobId, result: snapshot.result });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already running|HTTP 409/.test(message) && (await attachToRunning(modId))) return;
    if (/cancelled by user/i.test(message) || isStopHeld(modId)) {
      upsertModAiJob(modId, KIND, { status: 'cancelled', error: null });
    } else {
      upsertModAiJob(modId, KIND, { status: 'failed', error: message });
    }
  } finally {
    inFlight.delete(modId);
    jobIdByMod.delete(modId);
    if (!isActive(getModAiJob(modId, KIND))) clearWhenIdle(modId);
  }
};

/** Stop the analysis; what it measured so far is kept and the next run continues from there. */
export const stopModVoiceEffort = async (modId: number, jobId: number | null): Promise<void> => {
  const resolved = jobId ?? jobIdByMod.get(modId) ?? null;
  upsertModAiJob(modId, KIND, { status: 'stopping', error: null });
  try {
    if (resolved != null) await api.voiceEffortAnalysis.stop(resolved);
    else await api.voiceEffortAnalysis.stopMod(modId);
    upsertModAiJob(modId, KIND, { status: 'cancelled', error: null });
    clearWhenIdle(modId);
  } catch (err) {
    upsertModAiJob(modId, KIND, { error: err instanceof Error ? err.message : String(err) });
  }
};
