import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogTreeKind } from '../../../../../../api';
import type { DialogTreeRow as DialogTreeRowModel } from '../../dialogTreeView';
import { ProgressPill } from '../ProgressPill';
import styles from './DialogNavigator.module.scss';

export interface DialogTreeRowProps {
  row: DialogTreeRowModel;
  active: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

const KIND_CLASS: Record<DialogTreeKind, string> = {
  quest: styles.kindQuest,
  scene: styles.kindScene,
  branch: styles.kindBranch,
  topic: styles.kindTopic,
  group: styles.kindGroup,
};

/** One visible tree row: kind, label, progress, and an expand control. */
export const DialogTreeRow = memo(({ row, active, onSelect, onToggle }: DialogTreeRowProps) => {
  const { t } = useTranslation();
  const { node, depth, expanded } = row;
  const selectable = node.kind !== 'group';
  const canExpand = node.children.length > 0;
  const label = node.kind === 'group' ? t('dialogs.tree.orphans') : node.label;

  return (
    <div
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <button
        type="button"
        className={`${styles.chevron} ${canExpand ? '' : styles.chevronGhost}`}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={
          canExpand ? (expanded ? t('dialogs.tree.collapse') : t('dialogs.tree.expand')) : undefined
        }
        disabled={!canExpand}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {canExpand ? (expanded ? '▾' : '▸') : ''}
      </button>

      <button
        type="button"
        className={styles.rowBody}
        onClick={() => {
          if (selectable) onSelect();
          else onToggle();
        }}
        title={node.sublabel ?? label}
      >
        <span className={styles.rowTop}>
          <span className={`${styles.kind} ${KIND_CLASS[node.kind]}`}>
            {t(`dialogs.tree.kind.${node.kind}`)}
          </span>
          <span className={styles.rowLabel}>{label}</span>
          {node.timing_sensitive && (
            <span className={styles.rowTiming} title={t('dialogs.timingSensitiveTitle')}>
              {t('dialogs.timingSensitive')}
            </span>
          )}
          {node.qa_count > 0 && (
            <span
              className={styles.rowQa}
              title={t('dialogs.qaIssueCount', { count: node.qa_count })}
            >
              QA {node.qa_count}
            </span>
          )}
        </span>
        <span className={styles.rowBottom}>
          <ProgressPill
            done={node.translated_count}
            total={node.line_count}
            showCount
            title={t('dialogs.progressTitle', {
              done: node.translated_count,
              total: node.line_count,
            })}
          />
        </span>
      </button>
    </div>
  );
});

DialogTreeRow.displayName = 'DialogTreeRow';
