import { useCallback, useRef, useState } from 'react';
import { api, type LlmTranslateJobSnapshot, type LlmTranslateRow } from '../../../api';

export type AiTranslateState = {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  jobId: number | null;
  done: number;
  total: number;
  rows: LlmTranslateRow[];
  error: string | null;
};

const initialState: AiTranslateState = {
  status: 'idle',
  jobId: null,
  done: 0,
  total: 0,
  rows: [],
  error: null,
};

/** Manages mod-wide LLM translation — survives modal close while the stream runs. */
export const useAiTranslate = (modId: number, srcLang: string, targetLang: string) => {
  const [state, setState] = useState<AiTranslateState>(initialState);
  const inFlight = useRef(false);

  const applySnapshot = useCallback((snapshot: LlmTranslateJobSnapshot) => {
    setState({
      status: snapshot.status === 'running' ? 'running' : snapshot.status,
      jobId: snapshot.jobId,
      done: snapshot.done,
      total: snapshot.total,
      rows: snapshot.rows,
      error: snapshot.error,
    });
  }, []);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((prev) => ({
      ...prev,
      status: 'running',
      jobId: null,
      done: 0,
      total: 0,
      rows: [],
      error: null,
    }));

    try {
      const snapshot = await api.llmTranslate.start(modId, srcLang, targetLang, (event) => {
        if (event.type === 'started') {
          setState((prev) => ({
            ...prev,
            status: 'running',
            jobId: event.jobId,
            total: event.total,
            done: 0,
            rows: [],
          }));
        }
        if (event.type === 'progress') {
          setState((prev) => ({
            ...prev,
            done: event.done,
            total: event.total,
            rows: event.row ? [...prev.rows, event.row] : prev.rows,
          }));
        }
        if (event.type === 'done') {
          setState((prev) => ({
            ...prev,
            status: 'completed',
            done: event.done,
            total: event.total,
            rows: event.rows,
          }));
        }
        if (event.type === 'cancelled') {
          setState((prev) => ({
            ...prev,
            status: 'cancelled',
            done: event.done,
            total: event.total,
            rows: event.rows,
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
    if (!state.jobId) return;
    try {
      await api.llmTranslate.stop(state.jobId);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.jobId]);

  const successCount = state.rows.filter((r) => r.translation && !r.error).length;
  const errorCount = state.rows.filter((r) => r.error).length;

  return {
    ...state,
    isRunning: state.status === 'running',
    successCount,
    errorCount,
    start,
    stop,
  };
};
