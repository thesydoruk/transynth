/** Best-effort major GC. Requires the process to be started with `--expose-gc`. */
export const hintProcessGc = (): void => {
  const gc = (globalThis as typeof globalThis & { gc?: (opts?: object) => void }).gc;
  if (typeof gc !== 'function') return;
  try {
    gc({ type: 'major', execution: 'sync' });
  } catch {
    gc();
  }
};
