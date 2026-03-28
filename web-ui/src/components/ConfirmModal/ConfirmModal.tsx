import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { ModalShell } from '../ModalShell';
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

  return (
    <ModalShell
      onClose={onClose}
      closeDisabled={pending}
      role="alertdialog"
      ariaLabelledBy="confirm-modal-title"
      ariaDescribedBy="confirm-modal-body"
      title={<span id="confirm-modal-title">{title}</span>}
      closeAriaLabel={t('common.close')}
    >
      <p id="confirm-modal-body" className={s.body}>{message}</p>

      <div className={s.footer}>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          {pending ? '…' : (confirmLabel ?? t('common.delete'))}
        </Button>
      </div>
    </ModalShell>
  );
};
