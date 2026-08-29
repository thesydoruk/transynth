import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { DialogGroup, DialogScope } from '../../../../../../api';
import type { GroupSort } from '../../hooks/useDialogsState';
import { DialogGroupRow } from './DialogGroupRow';
import styles from './DialogNavigator.module.scss';

const SCOPES: DialogScope[] = ['topics', 'branches', 'scenes', 'conversations'];
const SORTS: GroupSort[] = ['label', 'progress', 'size'];
const ROW_HEIGHT = 50;

export interface DialogNavigatorProps {
  scope: DialogScope;
  onScopeChange: (scope: DialogScope) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sort: GroupSort;
  onSortChange: (sort: GroupSort) => void;
  hideDone: boolean;
  onHideDoneChange: (value: boolean) => void;
  /** Groups after search, sort, and the hide-finished toggle. */
  groups: DialogGroup[];
  /** How many groups the scope holds in total. */
  totalCount: number;
  activeKey: string | null;
  onSelect: (key: string) => void;
  /** Moves the selection by whole groups, used by the arrow keys in the search box. */
  onStepGroup: (delta: number) => void;
  isLoading: boolean;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Left column of the dialogs editor: scope switcher, search, and the list of
 * groups with their translation progress.
 *
 * The full list is held in memory and virtualized, so a mod with thousands of
 * topics filters and scrolls without paging.
 */
export const DialogNavigator = ({
  scope,
  onScopeChange,
  search,
  onSearchChange,
  sort,
  onSortChange,
  hideDone,
  onHideDoneChange,
  groups,
  totalCount,
  activeKey,
  onSelect,
  onStepGroup,
  isLoading,
  searchRef,
}: DialogNavigatorProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const activeIndex = groups.findIndex((group) => group.key === activeKey);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, virtualizer]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onStepGroup(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      searchRef.current?.blur();
    }
  };

  return (
    <aside className={styles.navigator}>
      <div className={styles.scopes} role="tablist">
        {SCOPES.map((value, index) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            className={`${styles.scope} ${scope === value ? styles.scopeActive : ''}`}
            onClick={() => onScopeChange(value)}
            title={t('dialogs.scopeHotkey', { key: index + 1 })}
          >
            {t(`dialogs.scope.${value}`)}
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <input
          ref={searchRef}
          className={styles.search}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('dialogs.searchPlaceholder')}
          aria-label={t('dialogs.searchPlaceholder')}
        />
        <div className={styles.controlRow}>
          <select
            className={styles.sort}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as GroupSort)}
            aria-label={t('dialogs.sortLabel')}
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`dialogs.sort.${value}`)}
              </option>
            ))}
          </select>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(event) => onHideDoneChange(event.target.checked)}
            />
            {t('dialogs.hideFinished')}
          </label>
        </div>
      </div>

      <div ref={scrollRef} className={styles.list}>
        {isLoading ? (
          <p className={styles.note}>{t('dialogs.loadingGroups')}</p>
        ) : groups.length === 0 ? (
          <p className={styles.note}>
            {totalCount === 0 ? t(`dialogs.empty.${scope}`) : t('dialogs.noMatches')}
          </p>
        ) : (
          <div className={styles.viewport} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={groups[item.index].key}
                className={styles.rowSlot}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <DialogGroupRow
                  group={groups[item.index]}
                  active={groups[item.index].key === activeKey}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        {t('dialogs.groupCount', { shown: groups.length, total: totalCount })}
      </footer>
    </aside>
  );
};
