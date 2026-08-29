export const normalizePath = (value: string | null | undefined): string =>
    (value ?? '').trim().replace(/\\+/g, '/').replace(/\/+/g, '/').toLowerCase();

  /**
   * Normalize FormID as uppercase stable identity text.
   */
export const normalizeFormId = (value: string | null | undefined): string =>
    (value ?? '').trim().toUpperCase();

  /**
   * Normalize EDID to case-insensitive match key.
   */
export const normalizeEdid = (value: string | null | undefined): string =>
    (value ?? '').trim().toLowerCase();

  /**
   * Keep only unambiguous candidates in a key map.
   * If two different translations map to the same key, the key is marked as
   * ambiguous (`null`) and is no longer used for automatic application.
   */
export const putUnique = (map: Map<string, string | null>, key: string, text: string): void => {
    if (!key) return;
    const existing = map.get(key);
    if (existing == null && !map.has(key)) {
      map.set(key, text);
      return;
    }
    if (existing !== text) {
      map.set(key, null);
    }
  };

  /**
   * Read a candidate from a map only when it is unique and non-empty.
   */
export const getUnique = (map: Map<string, string | null>, key: string): string | null => {
    const value = map.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  };
