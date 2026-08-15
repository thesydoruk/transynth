import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type LlmVerifyActionLogEntry,
  type LlmVerifyIssue,
  type LlmVerifyJobSnapshot,
} from '../../../api';

export type AiVerifyState = {
  status: 'idle' | 'running' | 'stopping' | 'completed' | 'cancelled' | 'failed';
  jobId: number | null;
  done: number;
  total: number;
  approved: number;
  fixed: number;
  issues: LlmVerifyIssue[];
  actionLog: LlmVerifyActionLogEntry[];
  error: string | null;
};

const initialState: AiVerifyState = {
  status: 'idle',
  jobId: null,
  done: 0,
  total: 0,
  approved: 0,
  fixed: 0,
  issues: [],
  actionLog: [],
  error: null,
};

const POLL_MS = 2000;

const isStopNotFoundError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  return /not found/i.test(err.message) || /\b404\b/.test(err.message);
};

const snapshotToState = (
  snapshot: LlmVerifyJobSnapshot,
  preserveStopping: boolean,
): AiVerifyState => ({
  status:
    snapshot.status === 'running' ? (preserveStopping ? 'stopping' : 'running') : snapshot.status,
  jobId: snapshot.jobId,
  done: snapshot.done,
  total: snapshot.total,
  approved: snapshot.approved,
  fixed: snapshot.fixed,
  issues: snapshot.issues ?? [],
  actionLog: snapshot.actionLog ?? [],
  error: snapshot.error,
});

/** Manages LLM translation verification — survives modal close and page reload. */
export const useAiVerify = (modId: number, srcLang: string, targetLang: string) => {
  const [state, setState] = useState<AiVerifyState>(initialState);
  const inFlight = useRef(false);
  /** Updated synchronously on SSE `started` so Stop works before the next render. */
  const jobIdRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  const applySnapshot = useCallback((snapshot: LlmVerifyJobSnapshot) => {
    jobIdRef.current = snapshot.jobId;
    setState((prev) =>
      snapshotToState(snapshot, prev.status === 'stopping' && snapshot.status === 'running'),
    );
  }, []);

  const attachToJob = useCallback(
    async (jobId: number) => {
      const snapshot = await api.llmVerify.status(jobId);
      applySnapshot(snapshot);
    },
    [applySnapshot],
  );

  // Reattach to a verify job that is still running after a page reload.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const active = await api.modAiJobs.listActive();
        if (cancelled) return;
        const job = active.find((entry) => entry.modId === modId && entry.kind === 'verify');
        if (!job) return;
        if (inFlight.current) return;
        await attachToJob(job.jobId);
      } catch {
        /* network blip — leave idle until the user starts/reopens */
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [attachToJob, modId]);

  // Poll snapshot while detached from the original SSE stream (e.g. after reload).
  useEffect(() => {
    const jobId = state.jobId;
    if (jobId == null) return;
    if (state.status !== 'running' && state.status !== 'stopping') return;

    let cancelled = false;
    const tick = async () => {
      // Live SSE owns updates while start() is in flight.
      if (inFlight.current) return;
      try {
        const snapshot = await api.llmVerify.status(jobId);
        if (cancelled || inFlight.current) return;
        applySnapshot(snapshot);
      } catch {
        /* keep last known state */
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applySnapshot, state.jobId, state.status]);

  const start = useCallback(
    async (autoApproveVerified = false, fixSuspicious = false, includeConfirmed = false) => {
      if (inFlight.current) return;
      if (statusRef.current === 'running' || statusRef.current === 'stopping') return;
      inFlight.current = true;
      streamAbortRef.current?.abort();
      const streamAbort = new AbortController();
      streamAbortRef.current = streamAbort;
      jobIdRef.current = null;
      setState((prev) => ({
        ...prev,
        status: 'running',
        jobId: null,
        done: 0,
        total: 0,
        approved: 0,
        fixed: 0,
        issues: [],
        actionLog: [],
        error: null,
      }));

      try {
        const snapshot = await api.llmVerify.start(
          modId,
          srcLang,
          targetLang,
          (event) => {
            if (event.type === 'started') {
              jobIdRef.current = event.jobId;
              setState((prev) => ({
                ...prev,
                status: prev.status === 'stopping' ? 'stopping' : 'running',
                jobId: event.jobId,
                total: event.total,
                done: 0,
                approved: 0,
                fixed: 0,
                issues: [],
                actionLog: [],
              }));
            }
            if (event.type === 'progress') {
              setState((prev) => ({
                ...prev,
                done: event.done,
                total: event.total,
                approved: event.approved,
                fixed: event.fixed,
                issues: event.issue ? [...prev.issues, event.issue] : prev.issues,
                actionLog: event.action ? [...prev.actionLog, event.action] : prev.actionLog,
              }));
            }
            if (event.type === 'done') {
              setState((prev) => ({
                ...prev,
                status: 'completed',
                done: event.done,
                total: event.total,
                approved: event.approved,
                fixed: event.fixed,
                issues: event.issues ?? prev.issues,
              }));
            }
            if (event.type === 'cancelled') {
              setState((prev) => ({
                ...prev,
                status: 'cancelled',
                done: event.done,
                total: event.total,
                approved: event.approved,
                fixed: event.fixed,
                issues: event.issues ?? prev.issues,
              }));
            }
            if (event.type === 'error') {
              setState((prev) => ({
                ...prev,
                status: 'failed',
                error: event.error,
              }));
            }
          },
          autoApproveVerified,
          fixSuspicious,
          includeConfirmed,
          streamAbort.signal,
        );
        if (snapshot) applySnapshot(snapshot);
      } catch (err) {
        if (streamAbort.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        const alreadyRunning = /already running \(job #(\d+)\)/i.exec(message);
        if (alreadyRunning) {
          try {
            await attachToJob(Number(alreadyRunning[1]));
            return;
          } catch {
            /* fall through to failed */
          }
        }
        setState((prev) => ({
          ...prev,
          status: prev.status === 'stopping' ? 'cancelled' : 'failed',
          error: message,
        }));
      } finally {
        inFlight.current = false;
        if (streamAbortRef.current === streamAbort) {
          streamAbortRef.current = null;
        }
      }
    },
    [applySnapshot, attachToJob, modId, srcLang, targetLang],
  );

  const stop = useCallback(async () => {
    if (statusRef.current !== 'running' && statusRef.current !== 'stopping') return;
    setState((prev) => ({ ...prev, status: 'stopping', error: null }));

    try {
      const jobId = jobIdRef.current;
      if (jobId != null) {
        await api.llmVerify.stop(jobId);
      } else {
        await api.llmVerify.stopMod(modId);
      }
      setState((prev) => ({ ...prev, status: 'cancelled', error: null }));
    } catch (err) {
      if (isStopNotFoundError(err)) return;
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [modId]);

  const reset = useCallback(() => {
    if (statusRef.current === 'running' || statusRef.current === 'stopping') return;
    jobIdRef.current = null;
    setState(initialState);
  }, []);

  return {
    ...state,
    isRunning: state.status === 'running' || state.status === 'stopping',
    isStopping: state.status === 'stopping',
    start,
    stop,
    reset,
  };
};
