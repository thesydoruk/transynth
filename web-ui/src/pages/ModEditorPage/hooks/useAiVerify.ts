import { useCallback, useRef, useState } from 'react';
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

const isStopNotFoundError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  return /not found/i.test(err.message) || /\b404\b/.test(err.message);
};

/** Manages LLM translation verification — survives modal close while the stream runs. */
export const useAiVerify = (modId: number, srcLang: string, targetLang: string) => {
  const [state, setState] = useState<AiVerifyState>(initialState);
  const inFlight = useRef(false);
  /** Updated synchronously on SSE `started` so Stop works before the next render. */
  const jobIdRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const applySnapshot = useCallback((snapshot: LlmVerifyJobSnapshot) => {
    jobIdRef.current = snapshot.jobId;
    setState({
      status: snapshot.status === 'running' ? 'running' : snapshot.status,
      jobId: snapshot.jobId,
      done: snapshot.done,
      total: snapshot.total,
      approved: snapshot.approved,
      fixed: snapshot.fixed,
      issues: snapshot.issues,
      actionLog: snapshot.actionLog ?? [],
      error: snapshot.error,
    });
  }, []);

  const start = useCallback(
    async (autoApproveVerified = false, fixSuspicious = false, includeConfirmed = false) => {
      if (inFlight.current) return;
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
                issues: event.issues,
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
                issues: event.issues,
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
        setState((prev) => ({
          ...prev,
          status: prev.status === 'stopping' ? 'cancelled' : 'failed',
          error: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        inFlight.current = false;
        if (streamAbortRef.current === streamAbort) {
          streamAbortRef.current = null;
        }
      }
    },
    [applySnapshot, modId, srcLang, targetLang],
  );

  const stop = useCallback(async () => {
    if (state.status !== 'running' && state.status !== 'stopping') return;
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
  }, [modId, state.status]);

  const reset = useCallback(() => {
    if (state.status === 'running' || state.status === 'stopping') return;
    jobIdRef.current = null;
    setState(initialState);
  }, [state.status]);

  return {
    ...state,
    isRunning: state.status === 'running' || state.status === 'stopping',
    isStopping: state.status === 'stopping',
    start,
    stop,
    reset,
  };
};
