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
  /** Width preset. 'md' = default 680 px max-width, 'xl' = up to 1100 px, '2xl' = up to 1400 px. */
  size?: 'md' | 'xl' | '2xl';
  /**
   * When true, the content area becomes a flex column container, allowing inner
   * flex children (e.g. a tableWrap with flex: 1) to fill available modal height.
   */
  stretchContent?: boolean;
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
  size = 'md',
  stretchContent = false,
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
        className={`${s.container}${size === 'xl' ? ` ${s.containerXl}` : ''}${size === '2xl' ? ` ${s.container2xl}` : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onClick={(event) => event.stopPropagation()}
      >
        {customHeader ??
          ((title != null || !hideCloseButton) && (
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
          ))}

        <div className={stretchContent ? s.contentStretch : s.content}>{children}</div>
      </div>
    </div>
  );
};
