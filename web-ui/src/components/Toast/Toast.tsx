import { useEffect } from 'react';
import s from './Toast.module.scss';

/** Duration in ms before the toast auto-dismisses. */
const AUTO_DISMISS_MS = 3000;

type ToastType = 'success' | 'warning' | 'error' | 'info';

interface ToastProps {
  /** Message to display. Pass null/undefined to hide the toast. */
  message: string | null | undefined;
  /** Toast variant determining background and border color. Defaults to 'info'. */
  type?: ToastType;
  /** Called when the toast should be cleared (after auto-dismiss or manual close). */
  onDismiss: () => void;
}

/**
 * Non-blocking, auto-dismissing notification banner.
 *
 * Renders at the bottom-right corner and disappears after {@link AUTO_DISMISS_MS} ms.
 * Callers control visibility via `message` (null = hidden).
 * Supports type variants: success, warning, error, or info (default).
 *
 * @example
 * const [toast, setToast] = useState<string | null>(null);
 * // ... after a mutation:
 * setToast(t('someKey.successMsg'));
 * // In JSX:
 * <Toast message={toast} type="success" onDismiss={() => setToast(null)} />
 */
export const Toast = ({ message, type = 'info', onDismiss }: ToastProps) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  const className = `${s.toast} ${s[`toast_${type}`]}`;

  return (
    <div className={className} role="status" aria-live="polite">
      <span className={s.text}>{message}</span>
      <button className={s.close} onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
};
