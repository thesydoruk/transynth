import { useCallback, useRef, useState } from 'react';
import { api, type LlmVerifyIssue, type LlmVerifyJobSnapshot } from '../../../api';

export type AiVerifyState = {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  jobId: number | null;
  done: number;
  total: number;
  issues: LlmVerifyIssue[];
  error: string | null;
};

const initialState: AiVerifyState = {
  status: 'idle',
  jobId: null,
  done: 0,
  total: 0,
  issues: [],
  error: null,
};

/** Manages LLM translation verification — survives modal close while the stream runs. */
export const useAiVerify = (modId: number, srcLang: string, targetLang: string) => {
  const [state, setState] = useState<AiVerifyState>(initialState);
  const inFlight = useRef(false);
  /** Updated synchronously on SSE `started` so Stop works before the next render. */
  const jobIdRef = useRef<number | null>(null);

  const applySnapshot = useCallback((snapshot: LlmVerifyJobSnapshot) => {
    jobIdRef.current = snapshot.jobId;
    setState({
      status: snapshot.status === 'running' ? 'running' : snapshot.status,
      jobId: snapshot.jobId,
      done: snapshot.done,
      total: snapshot.total,
      issues: snapshot.issues,
      error: snapshot.error,
    });
  }, []);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    jobIdRef.current = null;
    setState((prev) => ({
      ...prev,
      status: 'running',
      jobId: null,
      done: 0,
      total: 0,
      issues: [],
      error: null,
    }));

    try {
      const snapshot = await api.llmVerify.start(modId, srcLang, targetLang, (event) => {
        if (event.type === 'started') {
          jobIdRef.current = event.jobId;
          setState((prev) => ({
            ...prev,
            status: 'running',
            jobId: event.jobId,
            total: event.total,
            done: 0,
            issues: [],
          }));
        }
        if (event.type === 'progress') {
          setState((prev) => ({
            ...prev,
            done: event.done,
            total: event.total,
            issues: event.issue ? [...prev.issues, event.issue] : prev.issues,
          }));
        }
        if (event.type === 'done') {
          setState((prev) => ({
            ...prev,
            status: 'completed',
            done: event.done,
            total: event.total,
            issues: event.issues,
          }));
        }
        if (event.type === 'cancelled') {
          setState((prev) => ({
            ...prev,
            status: 'cancelled',
            done: event.done,
            total: event.total,
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
      });
      if (snapshot) applySnapshot(snapshot);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      inFlight.current = false;
    }
  }, [applySnapshot, modId, srcLang, targetLang]);

  const stop = useCallback(async () => {
    try {
      const jobId = jobIdRef.current;
      if (jobId != null) {
        await api.llmVerify.stop(jobId);
      } else {
        await api.llmVerify.stopMod(modId);
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [modId]);

  const reset = useCallback(() => {
    if (state.status === 'running') return;
    jobIdRef.current = null;
    setState(initialState);
  }, [state.status]);

  return {
    ...state,
    isRunning: state.status === 'running',
    start,
    stop,
    reset,
  };
};
