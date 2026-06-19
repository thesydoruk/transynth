import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Estimated height of one data table row (5+5 px padding + ~13 px line-height + 1 px border). */
const TABLE_ROW_HEIGHT_PX = 30;

/** Minimum page size regardless of available height. */
const MIN_PAGE_SIZE = 10;

/** Reserved height for the pagination/footer row under the table. */
const DEFAULT_RESERVED_HEIGHT_PX = 0;

/**
 * Calculates the optimal number of table rows per page based on the available
 * height of the scroll container.  Uses ResizeObserver so the value updates
 * automatically whenever the modal or the browser window is resized.
 *
 * The measurement runs synchronously inside useLayoutEffect, so the first
 * visible render already uses the correct page size — there is no flicker of
 * an intermediate wrong value.
 *
 * Usage:
 * ```tsx
 * const [pageSize, tableWrapRef] = useAutoPageSize();
 * // …
 * <div className={s.tableWrap} ref={tableWrapRef}>…</div>
 * ```
 *
 * @param rowHeightPx - Estimated row height in pixels (default 30 px).
 * @param reservedHeightPx - Height reserved for UI blocks outside the table
 *                           viewport (e.g. paginator), in pixels.
 * @returns A tuple of [pageSize, containerRef].  Attach containerRef to the
 *          table scroll-wrapper element.  The modal must use `stretchContent`
 *          on ModalShell so the wrapper has a bounded flex height.
 */
export const useAutoPageSize = (
  rowHeightPx: number = TABLE_ROW_HEIGHT_PX,
  reservedHeightPx: number = DEFAULT_RESERVED_HEIGHT_PX,
): [number, RefObject<HTMLDivElement | null>] => {
  const [pageSize, setPageSize] = useState(MIN_PAGE_SIZE);
  const ref = useRef<HTMLDivElement>(null);

  const recalculate = useCallback(
    (height: number) => {
      const effectiveHeight = Math.max(0, height - reservedHeightPx);
      setPageSize(Math.max(MIN_PAGE_SIZE, Math.floor(effectiveHeight / rowHeightPx)));
    },
    [reservedHeightPx, rowHeightPx],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Initial synchronous measurement before first paint.
    recalculate(el.clientHeight);

    const observer = new ResizeObserver(([entry]) => {
      recalculate(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [recalculate]);

  return [pageSize, ref];
};
