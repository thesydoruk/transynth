import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type DialogTreeNode } from '../../../../../../api';
import { StatusBadge } from '../../../../../../components/StatusBadge';
import styles from './DialogNodeCard.module.scss';

/** Props for a single dialog node card. */
export interface DialogNodeCardProps {
  /** The dialog node data from the API. */
  node: DialogTreeNode;
  /** Target language code — used when saving a translation. */
  targetLang: string;
  /** React Query key array to invalidate after save. */
  queryKey: unknown[];
}

/**
 * A card representing one INFO record inside a DIAL topic tree.
 *
 * Displays the speaker name, source text, current translation, and
 * translation status.  The translation field is inline-editable: clicking
 * it opens a textarea that saves via PATCH on blur or Ctrl+Enter.
 */
export const DialogNodeCard = ({ node, targetLang, queryKey }: DialogNodeCardProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.translation ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!node.string_id) return;
    setSaving(true);
    try {
      await api.strings.saveTranslation(node.string_id, draft, 'draft', targetLang);
      await qc.invalidateQueries({ queryKey });
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [node.string_id, draft, targetLang, qc, queryKey]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void handleSave(); }
    if (e.key === 'Escape') { setDraft(node.translation ?? ''); setEditing(false); }
  }, [handleSave, node.translation]);

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        {node.speaker_name && (
          <span className={styles.speaker} title={node.speaker_formid_hex ?? undefined}>
            {node.speaker_name}
          </span>
        )}
        <span className={styles.formid} title={t('dialogs.infoFormIdTitle')}>
          {node.info_formid_hex}
        </span>
        {node.string_id && (
          <StatusBadge status={node.status} small />
        )}
        {(node.qa_issue_count ?? 0) > 0 && (
          <span className={styles.qaBadge} title={t('dialogs.qaIssueCount', { count: node.qa_issue_count })}>
            QA {node.qa_issue_count}
          </span>
        )}
      </header>

      <div className={styles.source}>{node.source ?? <em className={styles.noString}>{t('dialogs.noSourceString')}</em>}</div>

      {editing ? (
        <div className={styles.editArea}>
          <textarea
            className={styles.textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (!saving) void handleSave(); }}
            autoFocus
            rows={3}
            placeholder={t('modEditor.enterTranslation')}
          />
          <span className={styles.editHint}>{t('dialogs.editHint')}</span>
        </div>
      ) : (
        <div
          className={`${styles.translation} ${!node.translation ? styles.empty : ''}`}
          onClick={() => { if (node.string_id) { setDraft(node.translation ?? ''); setEditing(true); } }}
          title={node.string_id ? t('dialogs.clickToEdit') : t('dialogs.noStringId')}
          role={node.string_id ? 'button' : undefined}
          tabIndex={node.string_id ? 0 : undefined}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setDraft(node.translation ?? ''); setEditing(true); } }}
        >
          {node.translation ?? <em>{t('dialogs.noTranslation')}</em>}
        </div>
      )}
    </article>
  );
};
