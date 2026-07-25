import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type DialogLine } from '../../../../../../api';
import { StatusBadge } from '../../../../../../components/StatusBadge';
import styles from './DialogLineEditor.module.scss';

/** Props for a single translatable dialog line. */
export interface DialogLineEditorProps {
  /** Source text plus translation state of one INFO subrecord. */
  line: DialogLine;
  /** Target language code — used when saving a translation. */
  targetLang: string;
  /** React Query key array to invalidate after save. */
  queryKey: unknown[];
}

/**
 * Source text and inline-editable translation of one dialog line.
 *
 * Shared by the topic tree and the scene conversation so both views save,
 * label, and badge lines identically. Prompts (the option the player picks)
 * are marked so they cannot be mistaken for a spoken response.
 */
export const DialogLineEditor = ({ line, targetLang, queryKey }: DialogLineEditorProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.translation ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.strings.saveTranslation(line.string_id, draft, 'draft', targetLang);
      await qc.invalidateQueries({ queryKey });
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [line.string_id, draft, targetLang, qc, queryKey]);

  const startEditing = useCallback(() => {
    setDraft(line.translation ?? '');
    setEditing(true);
  }, [line.translation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === 'Escape') {
        setDraft(line.translation ?? '');
        setEditing(false);
      }
    },
    [handleSave, line.translation],
  );

  return (
    <div className={styles.line}>
      <div className={styles.lineHead}>
        {line.kind === 'prompt' && (
          <span className={styles.promptTag} title={t('dialogs.promptTagTitle')}>
            {t('dialogs.promptTag')}
          </span>
        )}
        <StatusBadge status={line.status} small />
        {line.qa_issue_count > 0 && (
          <span
            className={styles.qaBadge}
            title={t('dialogs.qaIssueCount', { count: line.qa_issue_count })}
          >
            QA {line.qa_issue_count}
          </span>
        )}
      </div>

      <div className={styles.source}>{line.source}</div>

      {editing ? (
        <div className={styles.editArea}>
          <textarea
            className={styles.textarea}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!saving) void handleSave();
            }}
            autoFocus
            rows={3}
            placeholder={t('modEditor.enterTranslation')}
          />
          <span className={styles.editHint}>{t('dialogs.editHint')}</span>
        </div>
      ) : (
        <div
          className={`${styles.translation} ${!line.translation ? styles.empty : ''}`}
          onClick={startEditing}
          title={t('dialogs.clickToEdit')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              startEditing();
            }
          }}
        >
          {line.translation ?? <em>{t('dialogs.noTranslation')}</em>}
        </div>
      )}
    </div>
  );
};
