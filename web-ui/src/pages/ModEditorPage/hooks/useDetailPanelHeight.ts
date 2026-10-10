import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const DETAIL_PANEL_HEIGHT_STORAGE_KEY = 'mod-editor-detail-panel-height';

const DEFAULT_DETAIL_PANEL_HEIGHT = 360;
const MIN_DETAIL_PANEL_HEIGHT = 240;
const MIN_GRID_HEIGHT = 120;

const readStoredHeight = (): number => {
  try {
    const raw = localStorage.getItem(DETAIL_PANEL_HEIGHT_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_DETAIL_PANEL_HEIGHT) {
      return parsed;
    }
  } catch {
    // Ignore private-browsing / quota errors
  }
  return DEFAULT_DETAIL_PANEL_HEIGHT;
};

const clampHeight = (height: number, centerColHeight: number): number => {
  // On a phone the column can be shorter than the panel's usual floor; the
  // panel then gives way so a few grid rows stay visible above it.
  const minHeight = Math.min(MIN_DETAIL_PANEL_HEIGHT, Math.round(centerColHeight * 0.6));
  const maxHeight = Math.max(minHeight, centerColHeight - MIN_GRID_HEIGHT);
  return Math.min(maxHeight, Math.max(minHeight, height));
};

/** Persisted, draggable height for the mod-editor detail panel. */
export const useDetailPanelHeight = (centerColRef: RefObject<HTMLElement | null>) => {
  const [detailPanelHeight, setDetailPanelHeight] = useState(readStoredHeight);
  const [isResizing, setIsResizing] = useState(false);
  const heightRef = useRef(detailPanelHeight);

  heightRef.current = detailPanelHeight;

  const persistHeight = useCallback((height: number) => {
    try {
      localStorage.setItem(DETAIL_PANEL_HEIGHT_STORAGE_KEY, String(height));
    } catch {
      // Ignore quota / private-browsing errors
    }
  }, []);

  const applyHeight = useCallback(
    (next: number) => {
      const centerColHeight = centerColRef.current?.clientHeight ?? 0;
      const clamped = centerColHeight > 0 ? clampHeight(next, centerColHeight) : next;
      heightRef.current = clamped;
      setDetailPanelHeight(clamped);
      return clamped;
    },
    [centerColRef],
  );

  useEffect(() => {
    const el = centerColRef.current;
    if (!el) return;

    const syncToContainer = (): void => {
      const clamped = clampHeight(heightRef.current, el.clientHeight);
      if (clamped !== heightRef.current) {
        heightRef.current = clamped;
        setDetailPanelHeight(clamped);
        persistHeight(clamped);
      }
    };

    syncToContainer();
    const ro = new ResizeObserver(syncToContainer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [centerColRef, persistHeight]);

  const startDetailPanelResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = heightRef.current;
      setIsResizing(true);

      // Pointer events, not mouse events, so a finger can drag the divider too.
      const onMove = (ev: PointerEvent): void => {
        const delta = startY - ev.clientY;
        applyHeight(startHeight + delta);
      };

      const onUp = (): void => {
        setIsResizing(false);
        persistHeight(heightRef.current);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [applyHeight, persistHeight],
  );

  return { detailPanelHeight, isResizing, startDetailPanelResize };
};
