/**
 * One piece of work per key at a time, in arrival order, inside this process;
 * work under different keys does not wait for each other.
 */
const tails = new Map<string, Promise<void>>();

export const withKeyedLock = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  tails.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
};
