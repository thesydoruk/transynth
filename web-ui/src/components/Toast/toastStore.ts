/** Toast severity variants. */
export type ToastType = 'success' | 'warning' | 'error' | 'info';

/** Optional action button shown inside a toast. */
export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  action?: ToastAction;
  /** Auto-dismiss delay in ms. Defaults to 4s, or 8s when an action is present. */
  durationMs?: number;
};

export type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  durationMs: number;
};

type Listener = () => void;

const MAX_TOASTS = 5;
const DEFAULT_DURATION_MS = 4000;
const ACTION_DURATION_MS = 8000;

let toasts: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Subscribe to toast queue updates. */
export const subscribeToasts = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Current visible toasts (oldest first). */
export const listToasts = (): ToastItem[] => toasts;

/** Push a toast and return its id. */
export const pushToast = (
  message: string,
  type: ToastType = 'info',
  options?: ToastOptions,
): string => {
  const id = String(++nextId);
  const item: ToastItem = {
    id,
    message,
    type,
    action: options?.action,
    durationMs: options?.durationMs ?? (options?.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS),
  };
  toasts = [...toasts, item].slice(-MAX_TOASTS);
  emit();
  return id;
};

/** Remove one toast by id. */
export const dismissToast = (id: string) => {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
};

/** Clear every visible toast. */
export const dismissAllToasts = () => {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
};

/** Imperative toast API — usable outside React components. */
export const toast = {
  success: (message: string, options?: ToastOptions) => pushToast(message, 'success', options),
  error: (message: string, options?: ToastOptions) => pushToast(message, 'error', options),
  warning: (message: string, options?: ToastOptions) => pushToast(message, 'warning', options),
  info: (message: string, options?: ToastOptions) => pushToast(message, 'info', options),
};
