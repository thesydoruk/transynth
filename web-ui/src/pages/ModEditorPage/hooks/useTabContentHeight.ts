import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export const TAB_CONTENT_HEIGHT_STORAGE_KEY = 'mod-editor-tab-content-height';

export const DEFAULT_TAB_CONTENT_HEIGHT = 160;
export const MIN_TAB_CONTENT_HEIGHT = 80;
export const MIN_TEXT_PANELS_HEIGHT = 120;
const TAB_BAR_HEIGHT = 32;
const RESIZE_HANDLE_HEIGHT = 6;

const readStoredHeight = (): number => {
  try {
    const raw = localStorage.getItem(TAB_CONTENT_HEIGHT_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_TAB_CONTENT_HEIGHT) {
      return parsed;
    }
  } catch {
    // Ignore private-browsing / quota errors
  }
  return DEFAULT_TAB_CONTENT_HEIGHT;
};

const clampHeight = (height: number, detailPanelHeight: number): number => {
  const maxHeight = Math.max(
    MIN_TAB_CONTENT_HEIGHT,
    detailPanelHeight - MIN_TEXT_PANELS_HEIGHT - TAB_BAR_HEIGHT - RESIZE_HANDLE_HEIGHT,
  );
  return Math.min(maxHeight, Math.max(MIN_TAB_CONTENT_HEIGHT, height));
};

/** Persisted, draggable height for the detail-panel tab content (RAG / QA / history). */
export const useTabContentHeight = (detailPanelRef: RefObject<HTMLElement | null>) => {
  const [tabContentHeight, setTabContentHeight] = useState(readStoredHeight);
  const [isResizing, setIsResizing] = useState(false);
  const heightRef = useRef(tabContentHeight);

  heightRef.current = tabContentHeight;

  const persistHeight = useCallback((height: number) => {
    try {
      localStorage.setItem(TAB_CONTENT_HEIGHT_STORAGE_KEY, String(height));
    } catch {
      // Ignore quota / private-browsing errors
    }
  }, []);

  const applyHeight = useCallback(
    (next: number) => {
      const panelHeight = detailPanelRef.current?.clientHeight ?? 0;
      const clamped = panelHeight > 0 ? clampHeight(next, panelHeight) : next;
      heightRef.current = clamped;
      setTabContentHeight(clamped);
      return clamped;
    },
    [detailPanelRef],
  );

  useEffect(() => {
    const el = detailPanelRef.current;
    if (!el) return;

    const syncToContainer = (): void => {
      const clamped = clampHeight(heightRef.current, el.clientHeight);
      if (clamped !== heightRef.current) {
        heightRef.current = clamped;
        setTabContentHeight(clamped);
        persistHeight(clamped);
      }
    };

    syncToContainer();
    const ro = new ResizeObserver(syncToContainer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [detailPanelRef, persistHeight]);

  const startTabContentResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = heightRef.current;
      setIsResizing(true);

      const onMove = (ev: MouseEvent): void => {
        const delta = startY - ev.clientY;
        applyHeight(startHeight + delta);
      };

      const onUp = (): void => {
        setIsResizing(false);
        persistHeight(heightRef.current);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [applyHeight, persistHeight],
  );

  return { tabContentHeight, isResizing, startTabContentResize };
};
