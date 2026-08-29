import { useCallback, useRef, useState } from 'react';
import { api, type ApplyImportedJobSnapshot, type ApplyImportedStats } from '../../../api';

export type ApplyImportedState = {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
  jobId: number | null;
  done: number;
  total: number;
  stats: ApplyImportedStats;
  error: string | null;
};

const initialStats: ApplyImportedStats = {
  applied: 0,
  skipped: 0,
  unmatched: 0,
  empty: 0,
};

const initialState: ApplyImportedState = {
  status: 'idle',
  jobId: null,
  done: 0,
  total: 0,
  stats: initialStats,
  error: null,
};

/** Manages apply-imported translation job — survives modal close while the stream runs. */
export const useApplyImported = (modId: number, srcLang: string, targetLang: string) => {
  const [state, setState] = useState<ApplyImportedState>(initialState);
  const inFlight = useRef(false);

  const applySnapshot = useCallback((snapshot: ApplyImportedJobSnapshot) => {
    setState({
      status: snapshot.status === 'running' ? 'running' : snapshot.status,
      jobId: snapshot.jobId,
      done: snapshot.done,
      total: snapshot.total,
      stats: snapshot.stats,
      error: snapshot.error,
    });
  }, []);

  const start = useCallback(
    async (fromModId: number, importedLang: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({
        status: 'running',
        jobId: null,
        done: 0,
        total: 0,
        stats: initialStats,
        error: null,
      });

      try {
        const snapshot = await api.mods.applyImportedStream(
          modId,
          fromModId,
          importedLang,
          srcLang,
          targetLang,
          (event) => {
            if (event.type === 'started') {
              setState((prev) => ({
                ...prev,
                status: 'running',
                jobId: event.jobId,
                total: event.total,
                done: 0,
                stats: initialStats,
              }));
            }
            if (event.type === 'progress') {
              setState((prev) => ({
                ...prev,
                done: event.done,
                total: event.total,
                stats: event.stats,
              }));
            }
            if (event.type === 'done') {
              setState((prev) => ({
                ...prev,
                status: 'completed',
                done: event.done,
                total: event.total,
                stats: event.stats,
              }));
            }
            if (event.type === 'cancelled') {
              setState((prev) => ({
                ...prev,
                status: 'cancelled',
                done: event.done,
                total: event.total,
                stats: event.stats,
              }));
            }
          },
        );
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
    [applySnapshot, modId, srcLang, targetLang],
  );

  const stop = useCallback(async () => {
    if (!state.jobId) return;
    try {
      await api.mods.applyImportedStop(state.jobId);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.jobId]);

  const reset = useCallback(() => {
    if (state.status === 'running') return;
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
