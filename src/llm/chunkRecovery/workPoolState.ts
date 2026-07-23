import type { RunLlmChunkWithRecoveryOptions, WorkPoolState } from './types';

export const createWorkPoolState = <T>(
  resolve: () => void,
  shouldAbort?: () => boolean,
): WorkPoolState<T> => {
  const state: WorkPoolState<T> = {
    queue: [],
    inFlight: 0,
    pendingDelayed: 0,
    shouldAbort,
    pump: () => {},
    maybeDone: () => {
      if (state.queue.length === 0 && state.inFlight === 0 && state.pendingDelayed === 0) {
        resolve();
      }
    },
  };
  return state;
};

export const makeEnqueueRetry = <T>(
  state: WorkPoolState<T>,
): RunLlmChunkWithRecoveryOptions<T>['enqueueRetry'] => {
  return (chunk, nextAttempt, delayMs) => {
    state.pendingDelayed++;
    setTimeout(() => {
      state.pendingDelayed--;
      if (state.shouldAbort?.()) {
        state.maybeDone();
        return;
      }
      state.queue.push({ chunk: [...chunk], attempt: nextAttempt });
      state.pump();
      state.maybeDone();
    }, delayMs);
  };
};
