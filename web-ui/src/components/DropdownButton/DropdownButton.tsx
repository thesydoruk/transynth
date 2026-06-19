import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import s from './DropdownButton.module.scss';

export interface DropdownButtonItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface DropdownButtonProps {
  label: string;
  items: DropdownButtonItem[];
  variant?: 'secondary' | 'primary';
  size?: 'sm' | 'md';
  title?: string;
  disabled?: boolean;
}

/**
 * Toolbar button that opens a dropdown menu on click.
 * The menu is portaled to document.body so it is not clipped by overflow containers.
 */
export const DropdownButton = ({
  label,
  items,
  variant = 'secondary',
  size = 'sm',
  title,
  disabled = false,
}: DropdownButtonProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
  }, [open, updateMenuPosition, items]);

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

  return (
    <div className={s.container}>
      <button
        ref={triggerRef}
        type="button"
        className={`${s.trigger} ${s[variant]} ${s[size]}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={disabled}
      >
        {label}
        <span className={s.caret} aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className={s.menu} role="menu">
            {items.map((item, i) => (
              <button
                key={i}
                role="menuitem"
                className={s.item}
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
