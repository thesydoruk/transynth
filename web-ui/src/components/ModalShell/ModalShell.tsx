import { useEffect, type ReactNode } from 'react';
import s from './ModalShell.module.scss';

interface ModalShellProps {
  /** Called when the modal requests to close (Escape, backdrop, close button). */
  onClose: () => void;
  /** Main body content. */
  children: ReactNode;
  /** Optional modal title rendered in the default header. */
  title?: ReactNode;
  /** Optional fully custom header. When provided, default header is not rendered. */
  customHeader?: ReactNode;
  /** Hide the default close button in the default header. */
  hideCloseButton?: boolean;
  /** Disable all close interactions (Escape/backdrop/close button). */
  closeDisabled?: boolean;
  /** Disable close on backdrop click. */
  closeOnBackdrop?: boolean;
  /** Disable close on Escape key. */
  closeOnEscape?: boolean;
  /** Accessibility role for dialog root. */
  role?: 'dialog' | 'alertdialog';
  /** aria-labelledby target ID when needed. */
  ariaLabelledBy?: string;
  /** aria-describedby target ID when needed. */
  ariaDescribedBy?: string;
  /** Close button aria-label. */
  closeAriaLabel?: string;
}

/**
 * Shared modal shell with unified backdrop, Escape handling, and close behavior.
 *
 * This component standardizes modal interaction patterns and visual style.
 */
export const ModalShell = ({
  onClose,
  children,
  title,
  customHeader,
  hideCloseButton = false,
  closeDisabled = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  role = 'dialog',
  ariaLabelledBy,
  ariaDescribedBy,
  closeAriaLabel = 'Close dialog',
}: ModalShellProps) => {
  useEffect(() => {
    if (!closeOnEscape || closeDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDisabled, closeOnEscape, onClose]);

  const canCloseFromBackdrop = closeOnBackdrop && !closeDisabled;

  return (
    <div
      className={s.overlay}
      onClick={canCloseFromBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        className={s.container}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onClick={(event) => event.stopPropagation()}
      >
        {customHeader ?? (
          (title != null || !hideCloseButton) && (
            <div className={s.header}>
              {title != null ? (
                <h2 className={s.title}>{title}</h2>
              ) : (
                <span className={s.titleSpacer} />
              )}
              {!hideCloseButton && (
                <button
                  onClick={onClose}
                  className={s.closeBtn}
                  disabled={closeDisabled}
                  aria-label={closeAriaLabel}
                >
                  ✕
                </button>
              )}
            </div>
          )
        )}

        <div className={s.content}>{children}</div>
      </div>
    </div>
  );
};
