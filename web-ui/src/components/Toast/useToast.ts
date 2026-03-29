import { useState, useCallback } from 'react';

/** Toast severity variants matching the Toast component. */
type ToastType = 'success' | 'warning' | 'error' | 'info';

/** Shape returned by useToast. */
export interface UseToastReturn {
  /** Current toast state. Null when no toast is visible. */
  toast: { message: string; type: ToastType } | null;
  /**
   * Display a toast notification.
   * @param message - Text to show.
   * @param type - Visual variant. Defaults to 'info'.
   */
  showToast: (message: string, type?: ToastType) => void;
  /** Clear the current toast (also called automatically by the Toast component on dismiss). */
  clearToast: () => void;
}

/**
 * Local state hook for controlling a single Toast notification.
 *
 * Keeps toast state inside the calling component — no global context needed
 * since all current usages are page-level and don't cross component boundaries.
 *
 * @example
 * const { toast, showToast, clearToast } = useToast();
 * // after a mutation:
 * showToast(t('page.successMsg'), 'success');
 * // in JSX:
 * <Toast message={toast?.message ?? null} type={toast?.type} onDismiss={clearToast} />
 */
export function useToast(): UseToastReturn {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  return { toast, showToast, clearToast };
}
