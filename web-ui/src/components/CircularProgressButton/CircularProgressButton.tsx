import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import s from './CircularProgressButton.module.scss';

/** A single item in the circular progress button dropdown menu. */
export interface CircularProgressButtonMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export type CircularProgressButtonTone = 'default' | 'success' | 'danger';
export type CircularProgressButtonState = 'running' | 'completed' | 'failed';

type CircularProgressButtonBaseProps = {
  /** Icon rendered in the center of the progress ring. */
  icon: ReactNode;
  /** Progress fill 0–100. Omit or pass null to hide the progress ring entirely. */
  progress?: number | null;
  /** Accessible label for the trigger button. */
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Progress ring color. */
  tone?: CircularProgressButtonTone;
  /** Optional visual state for the trigger background. */
  state?: CircularProgressButtonState;
};

export type CircularProgressButtonProps = CircularProgressButtonBaseProps &
  (
    | { onClick: () => void; menuItems?: never }
    | { menuItems: CircularProgressButtonMenuItem[]; onClick?: never }
  );

const DIMENSION = { sm: 32, md: 40 } as const;
const STROKE = { sm: 2.5, md: 3 } as const;

const clampProgress = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Icon button with a circular progress ring.
 *
 * Click either runs `onClick` or opens a portaled dropdown when `menuItems` is set.
 */
export const CircularProgressButton = (props: CircularProgressButtonProps) => {
  const {
    icon,
    progress = null,
    ariaLabel,
    title,
    disabled = false,
    size = 'sm',
    tone = 'default',
    state,
  } = props;

  const stateClass =
    state === 'running'
      ? s.triggerRunning
      : state === 'completed'
        ? s.triggerCompleted
        : state === 'failed'
          ? s.triggerFailed
          : '';
  const toneClass =
    tone === 'success' ? s.progressSuccess : tone === 'danger' ? s.progressDanger : '';
  const hasMenu = 'menuItems' in props && props.menuItems != null;
  const menuItems = hasMenu ? props.menuItems : [];

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const dim = DIMENSION[size];
  const stroke = STROKE[size];
  const radius = (dim - stroke) / 2;
  const center = dim / 2;
  const circumference = 2 * Math.PI * radius;
  const showProgress = progress != null;
  const progressPct = showProgress ? clampProgress(progress) : 0;
  const dashOffset = circumference * (1 - progressPct / 100);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = rect.left;
    let top = rect.bottom + 4;

    if (left + menuRect.width > window.innerWidth) {
      left = Math.max(0, rect.right - menuRect.width);
    }
    if (top + menuRect.height > window.innerHeight) {
      top = Math.max(0, rect.top - menuRect.height - 4);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition, menuItems]);

  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleReposition = () => updateMenuPosition();

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open, updateMenuPosition]);

  const handleTriggerClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.stopPropagation();
    if (hasMenu) {
      setOpen((v) => !v);
      return;
    }
    props.onClick();
  };

  return (
    <div className={s.container}>
      <button
        ref={triggerRef}
        type="button"
        className={`${s.trigger} ${s[size]} ${open ? s.triggerOpen : ''} ${stateClass}`}
        onClick={handleTriggerClick}
        aria-label={ariaLabel}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        title={title}
        disabled={disabled}
      >
        <span className={`${s.ringWrap}${showProgress ? '' : ` ${s.iconOnly}`}`} aria-hidden>
          {showProgress && (
            <svg className={s.ring} width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`}>
              <circle
                className={s.track}
                cx={center}
                cy={center}
                r={radius}
                strokeWidth={stroke}
                fill="none"
              />
              <circle
                className={`${s.progress} ${toneClass}`}
                cx={center}
                cy={center}
                r={radius}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${center} ${center})`}
              />
            </svg>
          )}
          <span className={s.icon}>{icon}</span>
        </span>
      </button>
      {hasMenu &&
        open &&
        createPortal(
          <div ref={menuRef} className={s.menu} role="menu">
            {menuItems.map((item, i) => (
              <button
                key={i}
                role="menuitem"
                className={`${s.item} ${item.danger ? s.itemDanger : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};
