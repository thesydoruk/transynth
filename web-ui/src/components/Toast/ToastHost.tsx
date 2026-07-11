import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ToastItemView } from './Toast';
import { dismissToast, listToasts, subscribeToasts } from './toastStore';
import s from './Toast.module.scss';

const getServerSnapshot = () => [] as ReturnType<typeof listToasts>;

/**
 * Global toast stack rendered at the document root.
 * Mount once in {@link App} — individual pages call `toast` or `useToast`.
 */
export const ToastHost = () => {
  const items = useSyncExternalStore(subscribeToasts, listToasts, getServerSnapshot);

  useEffect(() => {
    if (items.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissToast(items[items.length - 1]!.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items]);

  if (items.length === 0) return null;

  return createPortal(
    <div className={s.host} aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <ToastItemView key={item.id} item={item} onDismiss={() => dismissToast(item.id)} />
      ))}
    </div>,
    document.body,
  );
};
