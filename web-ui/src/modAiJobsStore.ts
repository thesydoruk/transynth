/**
 * Client-side store for mod-scoped AI jobs (translate, verify, skip-detect, voice).
 * Synced from the mod editor SSE hooks and polled from the backend on the mods list.
 */

export type ModAiJobKind = 'translate' | 'verify' | 'skip-detect' | 'gender-detect' | 'voice';

export type ModAiJobStatus = 'idle' | 'running' | 'stopping' | 'completed' | 'cancelled' | 'failed';

export type ModTranslateMode = 'tm' | 'llm';

export type ModAiJobEntry = {
  modId: number;
  kind: ModAiJobKind;
  status: ModAiJobStatus;
  jobId: number | null;
  done: number;
  total: number;
  error: string | null;
  translateMode?: ModTranslateMode;
  /** Character folder key when voice job is scoped to one NPC; null = whole mod. */
  speakerKey?: string | null;
  updatedAt: number;
};

type Listener = () => void;

const jobs = new Map<string, ModAiJobEntry>();
const listeners = new Set<Listener>();

const jobKey = (modId: number, kind: ModAiJobKind) => `${modId}:${kind}`;

const emit = () => {
  for (const listener of listeners) listener();
};

const idleEntry = (modId: number, kind: ModAiJobKind): ModAiJobEntry => ({
  modId,
  kind,
  status: 'idle',
  jobId: null,
  done: 0,
  total: 0,
  error: null,
  updatedAt: Date.now(),
});

/** Returns the stored job entry or an idle placeholder. */
export const getModAiJob = (modId: number, kind: ModAiJobKind): ModAiJobEntry =>
  jobs.get(jobKey(modId, kind)) ?? idleEntry(modId, kind);

/** All job kinds for one mod. */
export const getModAiJobsForMod = (modId: number) => ({
  translate: getModAiJob(modId, 'translate'),
  verify: getModAiJob(modId, 'verify'),
  skipDetect: getModAiJob(modId, 'skip-detect'),
  genderDetect: getModAiJob(modId, 'gender-detect'),
  voice: getModAiJob(modId, 'voice'),
});

/** Every non-idle job across mods (newest update first). */
export const listModAiJobEntries = (): ModAiJobEntry[] =>
  [...jobs.values()].filter((j) => j.status !== 'idle').sort((a, b) => b.updatedAt - a.updatedAt);

export const subscribeModAiJobs = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export type UpsertModAiJobPatch = Partial<
  Pick<
    ModAiJobEntry,
    'status' | 'jobId' | 'done' | 'total' | 'error' | 'translateMode' | 'speakerKey'
  >
>;

/** Insert or merge a job entry and notify subscribers. */
export const upsertModAiJob = (modId: number, kind: ModAiJobKind, patch: UpsertModAiJobPatch) => {
  const key = jobKey(modId, kind);
  const prev = jobs.get(key) ?? idleEntry(modId, kind);
  jobs.set(key, {
    ...prev,
    ...patch,
    modId,
    kind,
    updatedAt: Date.now(),
  });
  emit();
};

/** Reset a job to idle (e.g. after a short completed badge TTL). */
export const clearModAiJob = (modId: number, kind: ModAiJobKind) => {
  const key = jobKey(modId, kind);
  if (!jobs.has(key)) return;
  jobs.delete(key);
  emit();
};
