import { api, type ModVoiceGenerateScope } from './api';
import { getModAiJob, upsertModAiJob, type ModAiJobEntry } from './modAiJobsStore';

const inFlight = new Set<number>();
const jobIdByMod = new Map<number, number>();

const isModVoiceJobActive = (entry: ModAiJobEntry): boolean =>
  entry.status === 'running' || entry.status === 'stopping';

const isVoiceAlreadyRunningError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  return err.message.includes('already running') || err.message.includes('HTTP 409');
};

/** Attach local store to an in-flight voice job on the server, if any. */
const syncRunningVoiceJobFromServer = async (modId: number): Promise<boolean> => {
  const active = await api.modAiJobs.listActive();
  const existing = active.find((job) => job.modId === modId && job.kind === 'voice');
  if (!existing) return false;

  upsertModAiJob(modId, 'voice', {
    status: 'running',
    jobId: existing.jobId,
    done: existing.done,
    total: existing.total,
    speakerKey: existing.speakerKey ?? null,
    error: null,
  });
  return true;
};

/** Start mod-wide or character-scoped voice synthesis; progress goes to the shared job store. */
export const startModAiVoice = async (
  modId: number,
  srcLang: string,
  targetLang: string,
  scope: ModVoiceGenerateScope = 'missing',
  speakerKey?: string,
): Promise<void> => {
  const entry = getModAiJob(modId, 'voice');
  if (isModVoiceJobActive(entry)) return;
  if (inFlight.has(modId)) return;

  const scopedSpeaker = speakerKey?.trim() || null;
  inFlight.add(modId);
  jobIdByMod.delete(modId);

  try {
    if (await syncRunningVoiceJobFromServer(modId)) return;

    upsertModAiJob(modId, 'voice', {
      status: 'running',
      jobId: null,
      done: 0,
      total: 0,
      speakerKey: scopedSpeaker,
      error: null,
    });

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
            speakerKey: scopedSpeaker,
            error: null,
          });
        }
        if (event.type === 'progress') {
          upsertModAiJob(modId, 'voice', {
            status: 'running',
            done: event.done,
            total: event.total,
            speakerKey: scopedSpeaker,
          });
        }
        if (event.type === 'done') {
          upsertModAiJob(modId, 'voice', {
            status: 'completed',
            done: event.done,
            total: event.total,
            speakerKey: scopedSpeaker,
            error: null,
          });
        }
        if (event.type === 'cancelled') {
          upsertModAiJob(modId, 'voice', {
            status: 'cancelled',
            done: event.done,
            total: event.total,
            speakerKey: scopedSpeaker,
          });
        }
      },
      undefined,
      scope,
      scopedSpeaker ?? undefined,
    );

    if (snapshot) {
      jobIdByMod.set(modId, snapshot.jobId);
      upsertModAiJob(modId, 'voice', {
        status: snapshot.status === 'running' ? 'running' : snapshot.status,
        jobId: snapshot.jobId,
        done: snapshot.done,
        total: snapshot.total,
        speakerKey: scopedSpeaker,
        error: snapshot.error,
      });
    }
  } catch (err) {
    if (isVoiceAlreadyRunningError(err) && (await syncRunningVoiceJobFromServer(modId))) {
      return;
    }
    upsertModAiJob(modId, 'voice', {
      status: 'failed',
      speakerKey: scopedSpeaker,
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
    upsertModAiJob(modId, 'voice', { status: 'cancelled', error: null });
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
  scope: ModVoiceGenerateScope = 'missing',
  speakerKey?: string,
): void => {
  if (isModVoiceJobActive(entry)) {
    void stopModAiVoice(modId, entry.jobId);
    return;
  }
  void startModAiVoice(modId, srcLang, targetLang, scope, speakerKey);
};
