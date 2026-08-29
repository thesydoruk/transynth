/**
 * Copy a previous localStorage value onto the current key once, then drop the
 * old key so the app only reads `transynth-*` after this visit.
 */
export const adoptStorageKey = (key: string, previousKey: string): void => {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(key) == null) {
    const previous = localStorage.getItem(previousKey);
    if (previous != null) localStorage.setItem(key, previous);
  }
  localStorage.removeItem(previousKey);
};
