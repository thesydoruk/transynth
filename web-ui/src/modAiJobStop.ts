import { api } from './api';
import {
  clearModAiJob,
  upsertModAiJob,
  type ModAiJobEntry,
  type ModAiJobKind,
} from './modAiJobsStore';

type TerminalStatus = 'completed' | 'cancelled' | 'failed';

const fetchJobSnapshot = async (
  kind: ModAiJobKind,
  jobId: number,
): Promise<{
  status: TerminalStatus | 'running';
  done: number;
  total: number;
  error: string | null;
} | null> => {
  try {
    if (kind === 'translate') {
      const snap = await api.llmTranslate.status(jobId);
      return snap;
    }
    if (kind === 'verify') {
      const snap = await api.llmVerify.status(jobId);
      return snap;
    }
    if (kind === 'voice') {
      const snap = await api.voiceGenerate.status(jobId);
      return snap;
    }
    if (kind === 'gender-detect') {
      const snap = await api.llmGenderDetect.status(jobId);
      return snap;
    }
    const snap = await api.llmSkipDetect.status(jobId);
    return snap;
  } catch {
    return null;
  }
};

/** Apply snapshot status to the local store when the queue row is already gone. */
export const reconcileModAiJobFromSnapshot = async (
  modId: number,
  kind: ModAiJobKind,
  jobId: number,
  keepSpeakerKey?: string | null,
): Promise<TerminalStatus | null> => {
  const snap = await fetchJobSnapshot(kind, jobId);
  if (!snap || snap.status === 'running') return null;
  upsertModAiJob(modId, kind, {
    status: snap.status,
    jobId,
    done: snap.done,
    total: snap.total,
    error: snap.error,
    ...(keepSpeakerKey !== undefined ? { speakerKey: keepSpeakerKey } : {}),
  });
  clearModAiJob(modId, kind);
  return snap.status;
};

/** Stop helpers shared by mod AI runners — always leave a terminal store state. */
export const finalizeModAiJobStop = async (
  modId: number,
  kind: ModAiJobKind,
  jobId: number | null,
  keepSpeakerKey?: string | null,
): Promise<void> => {
  if (jobId != null) {
    const terminal = await reconcileModAiJobFromSnapshot(modId, kind, jobId, keepSpeakerKey);
    if (terminal) return;
  }
  upsertModAiJob(modId, kind, {
    status: 'cancelled',
    error: null,
    ...(keepSpeakerKey !== undefined ? { speakerKey: keepSpeakerKey } : {}),
  });
  clearModAiJob(modId, kind);
};

export const isModAiJobActive = (entry: ModAiJobEntry): boolean =>
  entry.status === 'running' || entry.status === 'stopping';
