import { useCallback, useRef, useState, type CSSProperties, type MouseEvent } from 'react';

export const STRING_GRID_COLUMN_WIDTHS_STORAGE_KEY = 'mod-editor-string-grid-column-widths';

/** Keys identifying each resizable column in the string grid. */
export type StringGridColKey =
  | 'gender'
  | 'grup'
  | 'formid'
  | 'edid'
  | 'field'
  | 'src'
  | 'transl'
  | 'act';

export type StringGridColumnWidths = Record<StringGridColKey, number | null>;

export const DEFAULT_STRING_GRID_COLUMN_WIDTHS: StringGridColumnWidths = {
  gender: 28,
  grup: 52,
  formid: 70,
  edid: 160,
  field: 160,
  src: null,
  transl: null,
  act: 170,
};

const MIN_COLUMN_WIDTH = 30;

const COL_KEYS: StringGridColKey[] = [
  'gender',
  'grup',
  'formid',
  'edid',
  'field',
  'src',
  'transl',
  'act',
];

const readStoredWidths = (): StringGridColumnWidths => {
  try {
    const raw = localStorage.getItem(STRING_GRID_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) return DEFAULT_STRING_GRID_COLUMN_WIDTHS;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STRING_GRID_COLUMN_WIDTHS;

    const stored = parsed as Record<string, unknown>;
    const result = { ...DEFAULT_STRING_GRID_COLUMN_WIDTHS };

    for (const key of COL_KEYS) {
      const value = stored[key];
      if (value === null) {
        result[key] = null;
      } else if (typeof value === 'number' && Number.isFinite(value) && value >= MIN_COLUMN_WIDTH) {
        result[key] = value;
      }
    }

    return result;
  } catch {
    return DEFAULT_STRING_GRID_COLUMN_WIDTHS;
  }
};

/** Persisted, draggable column widths for the mod-editor string grid. */
export const useStringGridColumnWidths = () => {
  const [colWidths, setColWidths] = useState<StringGridColumnWidths>(readStoredWidths);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;

  const resizeRef = useRef<{ col: StringGridColKey; startX: number; startW: number } | null>(null);

  const persistWidths = useCallback((widths: StringGridColumnWidths) => {
    try {
      localStorage.setItem(STRING_GRID_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // Ignore quota / private-browsing errors
    }
  }, []);

  const startResize = useCallback(
    (col: StringGridColKey, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const thEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
      const startW = thEl.getBoundingClientRect().width;
      resizeRef.current = { col, startX: e.clientX, startW };

      const onMove = (ev: globalThis.MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientX - resizeRef.current.startX;
        const newW = Math.max(MIN_COLUMN_WIDTH, resizeRef.current.startW + delta);
        setColWidths((prev) => ({ ...prev, [resizeRef.current!.col]: newW }));
      };

      const onUp = () => {
        resizeRef.current = null;
        persistWidths(colWidthsRef.current);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [persistWidths],
  );

  const colStyle = useCallback(
    (col: StringGridColKey): CSSProperties => {
      const w = colWidths[col];
      return w !== null
        ? { flex: `0 0 ${w}px`, overflow: 'hidden' }
        : { flex: 1, minWidth: 180, overflow: 'hidden' };
    },
    [colWidths],
  );

  return { colWidths, colStyle, startResize };
};
