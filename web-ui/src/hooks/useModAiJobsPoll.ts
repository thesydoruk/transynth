import { useEffect } from 'react';
import { api } from '../api';
import {
  clearModAiJob,
  listModAiJobEntries,
  upsertModAiJob,
  type ModAiJobKind,
  type ModAiJobStatus,
} from '../modAiJobsStore';
import type { ActiveModAiJob } from '../api';

const TERMINAL_TTL_MS = 20_000;
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Local stop intent — poll must not resurrect these as running from a stale queue row. */
const HELD_LOCAL_STATUSES = new Set<ModAiJobStatus>([
  'stopping',
  'cancelled',
  'completed',
  'failed',
]);

const scheduleClear = (modId: number, kind: ModAiJobKind) => {
  const key = `${modId}:${kind}`;
  const prev = clearTimers.get(key);
  if (prev) window.clearTimeout(prev);
  clearTimers.set(
    key,
    window.setTimeout(() => {
      clearModAiJob(modId, kind);
      clearTimers.delete(key);
    }, TERMINAL_TTL_MS),
  );
};

const fetchTerminalStatus = async (
  kind: ModAiJobKind,
  jobId: number,
  translateMode?: 'tm' | 'llm',
): Promise<'completed' | 'cancelled' | 'failed' | null> => {
  try {
    if (kind === 'translate') {
      if (translateMode === 'tm') {
        const snap = await api.tmApply.status(jobId);
        return snap.status === 'running' ? null : snap.status;
      }
      const snap = await api.llmTranslate.status(jobId);
      return snap.status === 'running' ? null : snap.status;
    }
    if (kind === 'verify') {
      const snap = await api.llmVerify.status(jobId);
      return snap.status === 'running' ? null : snap.status;
    }
    if (kind === 'voice') {
      const snap = await api.voiceGenerate.status(jobId);
      return snap.status === 'running' ? null : snap.status;
    }
    if (kind === 'gender-detect') {
      const snap = await api.llmGenderDetect.status(jobId);
      return snap.status === 'running' ? null : snap.status;
    }
    const snap = await api.llmSkipDetect.status(jobId);
    return snap.status === 'running' ? null : snap.status;
  } catch {
    return null;
  }
};

/** Poll backend for running mod AI jobs and reconcile local store state. */
export const useModAiJobsPoll = (enabled = true, intervalMs = 3000) => {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const reconcile = async () => {
      try {
        const active: ActiveModAiJob[] = await api.modAiJobs.listActive();
        if (cancelled) return;

        const activeKeys = new Set(active.map((j: ActiveModAiJob) => `${j.modId}:${j.kind}`));

        for (const job of active) {
          const key = `${job.modId}:${job.kind}`;
          const prevTimer = clearTimers.get(key);
          if (prevTimer) {
            window.clearTimeout(prevTimer);
            clearTimers.delete(key);
          }
          const local = listModAiJobEntries().find(
            (entry) => entry.modId === job.modId && entry.kind === job.kind,
          );

          const terminal = await fetchTerminalStatus(job.kind, job.jobId, job.translateMode);
          if (cancelled) return;
          if (terminal) {
            upsertModAiJob(job.modId, job.kind, {
              status: terminal,
              jobId: job.jobId,
              done: job.done,
              total: job.total,
              translateMode: job.translateMode,
              ...(job.kind === 'voice' ? { speakerKey: job.speakerKey ?? null } : {}),
              error: null,
            });
            scheduleClear(job.modId, job.kind);
            continue;
          }

          if (local && HELD_LOCAL_STATUSES.has(local.status)) continue;

          upsertModAiJob(job.modId, job.kind, {
            status: 'running',
            jobId: job.jobId,
            done: job.done,
            total: job.total,
            translateMode: job.translateMode,
            ...(job.kind === 'voice' ? { speakerKey: job.speakerKey ?? null } : {}),
            error: null,
          });
        }

        for (const entry of listModAiJobEntries()) {
          const key = `${entry.modId}:${entry.kind}`;
          if (entry.status !== 'running' && entry.status !== 'stopping') continue;

          if (entry.jobId != null) {
            const terminal = await fetchTerminalStatus(
              entry.kind,
              entry.jobId,
              entry.translateMode,
            );
            if (cancelled) return;
            if (terminal) {
              upsertModAiJob(entry.modId, entry.kind, { status: terminal, error: null });
              scheduleClear(entry.modId, entry.kind);
              continue;
            }
          }

          if (activeKeys.has(key)) {
            if (entry.status === 'stopping') continue;
            continue;
          }

          if (entry.status === 'stopping') {
            upsertModAiJob(entry.modId, entry.kind, { status: 'cancelled', error: null });
            scheduleClear(entry.modId, entry.kind);
            continue;
          }

          if (entry.jobId == null) {
            continue;
          }

          upsertModAiJob(entry.modId, entry.kind, { status: 'completed', error: null });
          scheduleClear(entry.modId, entry.kind);
        }
      } catch {
        /* network blip — keep last known state */
      }
    };

    void reconcile();
    const timer = window.setInterval(() => void reconcile(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);
};
