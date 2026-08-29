import { useEffect } from 'react';
import type { ToastItem } from './toastStore';
import s from './Toast.module.scss';

interface ToastItemViewProps {
  item: ToastItem;
  onDismiss: () => void;
}

/**
 * Single auto-dismissing toast notification.
 * Rendered by {@link ToastHost}; prefer `toast` / `useToast` to show messages.
 */
export const ToastItemView = ({ item, onDismiss }: ToastItemViewProps) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, item.durationMs);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs, onDismiss]);

  const className = `${s.toast} ${s[`toast_${item.type}`]}`;

  return (
    <div className={className} role="status">
      <span className={s.text}>{item.message}</span>
      {item.action && (
        <button
          type="button"
          className={s.action}
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className={s.close} onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
};
