import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { DialogScope, DialogTreeNode } from '../../../../../../api';
import type { DialogTreeRow as DialogTreeRowModel } from '../../dialogTreeView';
import type { GroupSort } from '../../hooks/useDialogsState';
import { DialogTreeRow } from './DialogTreeRow';
import styles from './DialogNavigator.module.scss';

const SORTS: GroupSort[] = ['label', 'progress', 'size'];
const ROW_HEIGHT = 44;

export interface DialogNavigatorProps {
  search: string;
  onSearchChange: (value: string) => void;
  sort: GroupSort;
  onSortChange: (sort: GroupSort) => void;
  hideDone: boolean;
  onHideDoneChange: (value: boolean) => void;
  rows: DialogTreeRowModel[];
  /** Roots after search / hide-finished, used for expand-all. */
  visibleTree: DialogTreeNode[];
  totalQuestCount: number;
  activeScope: DialogScope;
  activeKey: string | null;
  onSelect: (scope: DialogScope, key: string) => void;
  onToggle: (id: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onStepGroup: (delta: number) => void;
  isLoading: boolean;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Left column of the dialogs editor: search plus the quest tree of scenes,
 * branches, and topics.
 */
export const DialogNavigator = ({
  search,
  onSearchChange,
  sort,
  onSortChange,
  hideDone,
  onHideDoneChange,
  rows,
  visibleTree,
  totalQuestCount,
  activeScope,
  activeKey,
  onSelect,
  onToggle,
  onExpandAll,
  onCollapseAll,
  onStepGroup,
  isLoading,
  searchRef,
}: DialogNavigatorProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const activeIndex = rows.findIndex(
    (row) =>
      row.node.kind !== 'group' && row.node.scope === activeScope && row.node.key === activeKey,
  );

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
        <div className={styles.controlRow}>
          <button type="button" className={styles.treeAction} onClick={onExpandAll}>
            {t('dialogs.tree.expandAll')}
          </button>
          <button type="button" className={styles.treeAction} onClick={onCollapseAll}>
            {t('dialogs.tree.collapseAll')}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className={styles.list}>
        {isLoading ? (
          <p className={styles.note}>{t('dialogs.loadingGroups')}</p>
        ) : rows.length === 0 ? (
          <p className={styles.note}>
            {totalQuestCount === 0 && visibleTree.length === 0
              ? t('dialogs.empty.tree')
              : t('dialogs.noMatches')}
          </p>
        ) : (
          <div className={styles.viewport} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={row.id}
                  className={styles.rowSlot}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <DialogTreeRow
                    row={row}
                    active={
                      row.node.kind !== 'group' &&
                      row.node.scope === activeScope &&
                      row.node.key === activeKey
                    }
                    onSelect={() => onSelect(row.node.scope, row.node.key)}
                    onToggle={() => onToggle(row.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        {t('dialogs.tree.rowCount', { shown: rows.length, quests: totalQuestCount })}
      </footer>
    </aside>
  );
};
