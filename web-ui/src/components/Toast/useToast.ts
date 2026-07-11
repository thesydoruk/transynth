import { useCallback } from 'react';
import { dismissAllToasts, pushToast, type ToastOptions, type ToastType } from './toastStore';

/** Shape returned by useToast. */
export interface UseToastReturn {
  /**
   * Display a toast notification.
   * @param message - Text to show.
   * @param type - Visual variant. Defaults to 'info'.
   * @param options - Optional action button or custom duration.
   */
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
  /** Clear all visible toasts. */
  clearToast: () => void;
}

/**
 * Hook wrapper around the global toast store.
 * Toasts are rendered by {@link ToastHost} mounted in the app root.
 */
export function useToast(): UseToastReturn {
  const showToast = useCallback(
    (message: string, type: ToastType = 'info', options?: ToastOptions) => {
      pushToast(message, type, options);
    },
    [],
  );

  const clearToast = useCallback(() => {
    dismissAllToasts();
  }, []);

  return { showToast, clearToast };
}
