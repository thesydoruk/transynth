import { useEffect, useRef, useState } from 'react';
import s from './OverflowMenu.module.scss';

/** A single item in the overflow menu. */
export interface OverflowMenuItem {
  /** Display label. */
  label: string;
  /** Called when the item is clicked. */
  onClick: () => void;
  /** When true, renders the item in danger (red) style. */
  danger?: boolean;
  /** Disables the item when true. */
  disabled?: boolean;
}

interface OverflowMenuProps {
  /** Menu items to show in the dropdown. */
  items: OverflowMenuItem[];
  /** Accessible label for the toggle button (default: "More actions"). */
  label?: string;
}

/**
 * Compact overflow menu ("⋯" button) for secondary row actions.
 *
 * Renders a small trigger button that opens a floating dropdown on click.
 * The menu closes when the user clicks outside or presses Escape.
 *
 * @example
 * <OverflowMenu items={[
 *   { label: t('common.delete'), onClick: () => setPendingDeleteId(row.id), danger: true },
 * ]} />
 */
export const OverflowMenu = ({ items, label = 'More actions' }: OverflowMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={s.container} ref={containerRef}>
      <button
        className={s.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
      >
        ⋯
      </button>
      {open && (
        <div className={s.menu} role="menu">
          {items.map((item, i) => (
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
        </div>
      )}
    </div>
  );
};
