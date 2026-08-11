import { createRequire } from 'node:module';
import { UaStressTrie } from 'ua-word-stress';

const require = createRequire(import.meta.url);

/** Minimal trie surface used by hybrid stress placement (mockable in tests). */
export type UkStressDictionary = {
  lookupFull: (word: string) => {
    stress: number;
    type: 'unique' | 'variative' | 'heteronym';
  } | null;
};

let triePromise: Promise<UkStressDictionary> | null = null;

/** Load the offline Ukrainian stress trie once per process. */
export const getUkStressDictionary = (): Promise<UkStressDictionary> => {
  if (!triePromise) {
    const dataPath = require.resolve('ua-word-stress/data/ua_stress.ctrie.gz');
    triePromise = UaStressTrie.fromFile(dataPath);
  }
  return triePromise;
};

/** Test helper — inject a mock dictionary (or reset with null). */
export const setUkStressDictionaryForTests = (
  dict: UkStressDictionary | null | Promise<UkStressDictionary>,
): void => {
  triePromise = dict == null ? null : Promise.resolve(dict);
};
