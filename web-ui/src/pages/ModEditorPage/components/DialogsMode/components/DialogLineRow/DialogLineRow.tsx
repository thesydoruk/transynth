import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogLine } from '../../../../../../api';
import { StatusBadge } from '../../../../../../components/StatusBadge';
import type { DialogReviewStatus } from '../../hooks/useDialogLineSave';
import type { DialogLineVoice } from '../../hooks/useDialogVoice';
import { VoiceButtons } from './VoiceButtons';
import styles from './DialogLineRow.module.scss';

/** Where the cursor goes after a translation is committed. */
export type CommitAdvance = 'none' | 'next' | 'nextTodo';

export interface DialogLineRowProps {
  line: DialogLine;
  focused: boolean;
  editing: boolean;
  saving: boolean;
  onFocus: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onCommit: (text: string, advance: CommitAdvance) => void;
  onSetStatus: (status: DialogReviewStatus) => void;
  /** Playback controls, or null when the line has no voice-over on disk. */
  voice: DialogLineVoice | null;
}

/**
 * Source text and inline-editable translation of one dialog line.
 *
 * The row is the unit the keyboard cursor moves over: it scrolls itself into
 * view when focused, opens an editor in place, and hands control back to the
 * parent when the translator asks to continue to the next line.
 */
export const DialogLineRow = ({
  line,
  focused,
  editing,
  saving,
  onFocus,
  onEdit,
  onCancel,
  onCommit,
  onSetStatus,
  voice,
}: DialogLineRowProps) => {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);
  const [draft, setDraft] = useState(line.translation ?? '');

  useEffect(() => {
    if (editing) {
      cancelledRef.current = false;
      setDraft(line.translation ?? '');
    }
  }, [editing, line.translation]);

  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  useEffect(() => {
    const area = areaRef.current;
    if (!editing || !area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [editing, draft]);

  const commit = (advance: CommitAdvance) => {
    cancelledRef.current = advance !== 'none';
    onCommit(draft, advance);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      commit(event.shiftKey ? 'nextTodo' : 'next');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelledRef.current = true;
      onCancel();
    }
  };

  return (
    <div
      ref={rowRef}
      className={`${styles.row} ${focused ? styles.focused : ''} ${saving ? styles.saving : ''}`}
      onMouseDown={onFocus}
    >
      <div className={styles.meta}>
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
        {voice && <VoiceButtons voice={voice} />}
        <span className={styles.spacer} />
        {saving && <span className={styles.savingTag}>{t('dialogs.saving')}</span>}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => onSetStatus('reviewed')}
            disabled={!line.translation}
            title={t('dialogs.approveTitle')}
          >
            {t('dialogs.approve')}
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => onCommit('', 'none')}
            disabled={!line.translation}
            title={t('dialogs.clearTitle')}
          >
            {t('dialogs.clear')}
          </button>
        </div>
      </div>

      <p className={styles.source}>{line.source}</p>

      {editing ? (
        <textarea
          ref={areaRef}
          className={styles.textarea}
          value={draft}
          disabled={saving}
          autoFocus
          rows={1}
          placeholder={t('modEditor.enterTranslation')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!cancelledRef.current) commit('none');
          }}
        />
      ) : (
        <button
          type="button"
          className={`${styles.translation} ${line.translation ? '' : styles.empty}`}
          onClick={onEdit}
          title={t('dialogs.clickToEdit')}
        >
          {line.translation || t('dialogs.noTranslation')}
        </button>
      )}
    </div>
  );
};
