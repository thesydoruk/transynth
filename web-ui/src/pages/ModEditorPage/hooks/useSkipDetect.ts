import { useCallback, useRef, useState } from 'react';
import { api, type LlmSkipDetectCandidate, type LlmSkipDetectJobSnapshot } from '../../../api';

export type SkipDetectState = {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  jobId: number | null;
  done: number;
  total: number;
  useLlm: boolean;
  candidates: LlmSkipDetectCandidate[];
  error: string | null;
};

const initialState: SkipDetectState = {
  status: 'idle',
  jobId: null,
  done: 0,
  total: 0,
  useLlm: false,
  candidates: [],
  error: null,
};

/** Manages non-translatable string detection — survives modal close while the stream runs. */
export const useSkipDetect = (modId: number, srcLang: string) => {
  const [state, setState] = useState<SkipDetectState>(initialState);
  const inFlight = useRef(false);
  const jobIdRef = useRef<number | null>(null);

  const applySnapshot = useCallback((snapshot: LlmSkipDetectJobSnapshot) => {
    jobIdRef.current = snapshot.jobId;
    setState((prev) => ({
      status: snapshot.status === 'running' ? 'running' : snapshot.status,
      jobId: snapshot.jobId,
      done: snapshot.done,
      total: snapshot.total,
      useLlm: prev.useLlm,
      candidates: snapshot.candidates,
      error: snapshot.error,
    }));
  }, []);

  const start = useCallback(
    async (useLlm: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      jobIdRef.current = null;
      setState({
        status: 'running',
        jobId: null,
        done: 0,
        total: 0,
        useLlm,
        candidates: [],
        error: null,
      });

      try {
        const snapshot = await api.llmSkipDetect.start(modId, srcLang, useLlm, (event) => {
          if (event.type === 'started') {
            jobIdRef.current = event.jobId;
            setState((prev) => ({
              ...prev,
              status: 'running',
              jobId: event.jobId,
              total: event.total,
              useLlm: event.useLlm,
              done: 0,
              candidates: [],
            }));
          }
          if (event.type === 'progress') {
            setState((prev) => ({
              ...prev,
              done: event.done,
              total: event.total,
              candidates: event.candidate ? [...prev.candidates, event.candidate] : prev.candidates,
            }));
          }
          if (event.type === 'done') {
            setState((prev) => ({
              ...prev,
              status: 'completed',
              done: event.done,
              total: event.total,
              candidates: event.candidates,
            }));
          }
          if (event.type === 'cancelled') {
            setState((prev) => ({
              ...prev,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              candidates: event.candidates,
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
    },
    [applySnapshot, modId, srcLang],
  );

  const stop = useCallback(async () => {
    try {
      const jobId = jobIdRef.current;
      if (jobId != null) {
        await api.llmSkipDetect.stop(jobId);
      } else {
        await api.llmSkipDetect.stopMod(modId);
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
