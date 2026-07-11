import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { statusAccentColor } from '../../../../components/StatusBadge/statusColors';
import { STATUS_FILTER_OPTS, type StatusFilterValue } from '../../statusFilter';
import styles from './StatusFilter.module.scss';

export interface StatusFilterProps {
  selected: StatusFilterValue[];
  onChange: (selected: StatusFilterValue[]) => void;
}

/**
 * Multi-select dropdown for translation-status filters in the editor toolbar.
 */
export const StatusFilter = ({ selected, onChange }: StatusFilterProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const label =
    selected.length === 0 ? (
      t('modEditor.allStatuses')
    ) : selected.length <= 2 ? (
      <span className={styles.triggerLabels}>
        {selected.map((status) => (
          <span key={status} className={styles.triggerChip}>
            <span
              className={styles.statusDot}
              style={{ '--status-color': statusAccentColor(status) } as React.CSSProperties}
              aria-hidden
            />
            {t(`status.${status}`, { defaultValue: status })}
          </span>
        ))}
      </span>
    ) : (
      t('modEditor.statusFilterCount', { count: selected.length })
    );

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
  }, [open, updateMenuPosition, selected]);

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

  const toggle = (status: StatusFilterValue) => {
    const set = new Set(selected);
    if (set.has(status)) set.delete(status);
    else set.add(status);
    onChange(STATUS_FILTER_OPTS.filter((s) => set.has(s)));
  };

  return (
    <div className={styles.container}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger}${selected.length > 0 ? ` ${styles.triggerActive}` : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('modEditor.statusFilterTitle')}
      >
        {label}
        <span className={styles.caret} aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className={styles.menu} role="listbox" aria-multiselectable>
            {STATUS_FILTER_OPTS.map((status) => (
              <label key={status} className={styles.item}>
                <input
                  type="checkbox"
                  checked={selected.includes(status)}
                  onChange={() => toggle(status)}
                />
                <span
                  className={styles.statusDot}
                  style={{ '--status-color': statusAccentColor(status) } as React.CSSProperties}
                  aria-hidden
                />
                {t(`status.${status}`, { defaultValue: status })}
              </label>
            ))}
            <div className={styles.actions}>
              <button type="button" className={styles.actionBtn} onClick={() => onChange([])}>
                {t('modEditor.allStatuses')}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
