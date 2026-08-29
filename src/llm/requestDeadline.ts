/** Combine parent abort (job stop) with a per-request deadline. */
export const withRequestDeadline = async <T>(
  deadlineMs: number,
  parentSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  if (parentSignal?.aborted) {
    throw parentSignal.reason ?? new Error('Aborted');
  }
  if (deadlineMs <= 0) {
    const noop = new AbortController();
    return fn(parentSignal ?? noop.signal);
  }

  const controller = new AbortController();
  const unsubs: Array<() => void> = [];

  const link = (source: AbortSignal): void => {
    if (source.aborted) {
      controller.abort(source.reason);
      return;
    }
    const onAbort = (): void => controller.abort(source.reason);
    source.addEventListener('abort', onAbort, { once: true });
    unsubs.push(() => source.removeEventListener('abort', onAbort));
  };

  if (parentSignal) link(parentSignal);

  const timer = setTimeout(() => {
    controller.abort(Object.assign(new Error('Request timed out.'), { name: 'TimeoutError' }));
  }, deadlineMs);
  unsubs.push(() => clearTimeout(timer));

  try {
    return await fn(controller.signal);
  } catch (err) {
    if (!parentSignal?.aborted && controller.signal.aborted) {
      throw new Error('Request timed out.');
    }
    throw err;
  } finally {
    for (const unsub of unsubs) unsub();
  }
};
