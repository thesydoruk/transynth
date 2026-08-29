import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'voice-navigator-width';
const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 280;

const clamp = (value: number) => Math.min(Math.max(value, MIN_WIDTH), MAX_WIDTH);

/** Draggable width of the voice speaker navigator, remembered between sessions. */
export const useVoiceNavigatorWidth = () => {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // Ignore quota / private-browsing errors
    }
  }, [width]);

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setIsResizing(true);

      const onMove = (moveEvent: MouseEvent) =>
        setWidth(clamp(startWidth + moveEvent.clientX - startX));
      const onUp = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [width],
  );

  return { width, isResizing, startResize };
};
