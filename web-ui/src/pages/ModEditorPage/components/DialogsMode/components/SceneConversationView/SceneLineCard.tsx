import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type SceneDialogLine } from '../../../../../../api';
import { StatusBadge } from '../../../../../../components/StatusBadge';
import styles from './SceneConversationView.module.scss';

interface SceneLineCardProps {
  line: SceneDialogLine;
  targetLang: string;
  queryKey: unknown[];
}

/**
 * Deterministic HSL hue from a string identifier — same algorithm as
 * {@link DialogNodeCard}'s `speakerHue` to keep colors consistent.
 */
const speakerHue = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
};

/**
 * A single conversation line within a scene.  Reuses the same speaker-color
 * approach and inline-editing pattern as {@link DialogNodeCard}.
 */
export const SceneLineCard = ({ line, targetLang, queryKey }: SceneLineCardProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.translation ?? '');
  const [saving, setSaving] = useState(false);

  const stringId = line.string_id;

  const handleSave = useCallback(async () => {
    if (!stringId) return;
    setSaving(true);
    try {
      await api.strings.saveTranslation(stringId, draft, 'draft', targetLang);
      await qc.invalidateQueries({ queryKey });
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [stringId, draft, targetLang, qc, queryKey]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void handleSave(); }
    if (e.key === 'Escape') { setDraft(line.translation ?? ''); setEditing(false); }
  }, [handleSave, line.translation]);

  /* Speaker identification:
     - Use speaker_name from the DB (ANAM or voice file lookup)
     - Fall back to alias_id label: -2 → "Player", >= 0 → "Alias N" */
  const speakerLabel = line.speaker_name
    ?? (line.alias_id === -2 ? t('dialogs.playerAlias') : t('dialogs.aliasLabel', { id: line.alias_id }));

  /* Color key: use speaker_name for consistency with DialogNodeCard, else alias_id string */
  const colorKey = line.speaker_name ?? String(line.alias_id);
  const hue = speakerHue(colorKey);
  const cardStyle = { '--speaker-hue': hue } as React.CSSProperties;

  return (
    <article className={styles.lineCard} style={cardStyle}>
      <header className={styles.lineHead}>
        <span className={styles.speaker} title={line.topic_formid_hex}>
          {speakerLabel}
        </span>
        {line.info_formid_hex && (
          <span className={styles.formid} title={t('dialogs.infoFormIdTitle')}>
            {line.info_formid_hex}
          </span>
        )}
        {line.string_id && (
          <StatusBadge status={line.status} small />
        )}
        {(line.qa_issue_count ?? 0) > 0 && (
          <span className={styles.qaBadge} title={t('dialogs.qaIssueCount', { count: line.qa_issue_count })}>
            QA {line.qa_issue_count}
          </span>
        )}
      </header>

      <div className={styles.source}>
        {line.source ?? <em className={styles.noString}>{t('dialogs.noSourceString')}</em>}
      </div>

      {editing ? (
        <div className={styles.editArea}>
          <textarea
            className={styles.textarea}
            value={draft}
            disabled={saving}
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
          className={`${styles.translation} ${!line.translation ? styles.empty : ''}`}
          onClick={() => { if (line.string_id) { setDraft(line.translation ?? ''); setEditing(true); } }}
          title={line.string_id ? t('dialogs.clickToEdit') : t('dialogs.noStringId')}
          role={line.string_id ? 'button' : undefined}
          tabIndex={line.string_id ? 0 : undefined}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setDraft(line.translation ?? ''); setEditing(true); } }}
        >
          {line.translation ?? <em>{t('dialogs.noTranslation')}</em>}
        </div>
      )}
    </article>
  );
};
