import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import s from './ConfirmModal.module.scss';

export interface ConfirmModalProps {
  /** Dialog heading, e.g. "Delete rule". */
  title: string;
  /** Descriptive message body explaining the consequences. */
  message: string;
  /** Label for the confirm button (defaults to "Delete"). */
  confirmLabel?: string;
  /** Whether the confirm action is running (shows spinner and disables buttons). */
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Generic, accessible confirmation modal for destructive actions.
 *
 * - Traps Escape → close (when not pending).
 * - Clicking the backdrop → close (when not pending).
 * - Displays a title, a descriptive message, and Cancel / Confirm buttons.
 * - Confirm button is styled with `--danger` color.
 *
 * @example
 * ```tsx
 * {pendingDelete != null && (
 *   <ConfirmModal
 *     title={t('tradAuto.deleteTitle')}
 *     message={t('tradAuto.deleteMessage')}
 *     pending={removeMut.isPending}
 *     onConfirm={() => removeMut.mutate(pendingDelete)}
 *     onClose={() => setPendingDelete(null)}
 *   />
 * )}
 * ```
 */
export const ConfirmModal = ({
  title,
  message,
  confirmLabel,
  pending = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pending, onClose]);

  return (
    <div className={s.overlay} onClick={pending ? undefined : onClose} role="presentation">
      <div
        className={s.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.header}>
          <h2 id="confirm-modal-title" className={s.title}>{title}</h2>
          <button
            className={s.closeBtn}
            onClick={onClose}
            disabled={pending}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <p id="confirm-modal-body" className={s.body}>{message}</p>

        <div className={s.footer}>
          <button className={s.btnCancel} onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </button>
          <button className={s.btnDanger} onClick={onConfirm} disabled={pending}>
            {pending ? '…' : (confirmLabel ?? t('common.delete'))}
          </button>
        </div>
      </div>
    </div>
  );
};
