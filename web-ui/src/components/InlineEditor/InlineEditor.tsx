import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import s from './InlineEditor.module.scss';

type Props = {
  stringId: number;
  translationId: number | null;
  text: string | null;
  status: string | null;
  queryKey: unknown[];
};

export const InlineEditor = ({ stringId, translationId, text, status, queryKey }: Props) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.selectionStart = ref.current.value.length;
    }
  }, [editing]);

  const save = useMutation({
    mutationFn: () => api.strings.saveTranslation(stringId, draft, 'draft'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setEditing(false);
    },
  });

  const approve = useMutation({
    mutationFn: () =>
      translationId
        ? api.strings.updateStatus(stringId, translationId, 'reviewed')
        : Promise.reject(new Error('no translation')),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  if (editing) {
    return (
      <div className={s.editContainer}>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(2, draft.split('\n').length)}
          className={s.textarea}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.mutate();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <div className={s.btnRow}>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className={s.btnSave}
          >
            {t('common.save')}
          </button>
          <button onClick={() => setEditing(false)} className={s.btnCancel}>
            {t('common.cancel')}
          </button>
        </div>
        {save.isError && (
          <span className={s.saveError}>{save.error?.message}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={s.viewContainer}
      onClick={() => {
        setDraft(text ?? '');
        setEditing(true);
      }}
      title={t('editor.clickToEdit')}
    >
      <span className={text ? s.text : s.textEmpty}>
        {text ?? t('editor.emptyClickToAdd')}
      </span>
      <div className={s.actions} onClick={(e) => e.stopPropagation()}>
        {text && status !== 'reviewed' && status !== 'human' && translationId && (
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className={s.btnApprove}
            title={t('editor.markAsApproved')}
          >
            ✓
          </button>
        )}
        <button
          onClick={() => {
            setDraft(text ?? '');
            setEditing(true);
          }}
          className={s.btnEdit}
          title={t('editor.edit')}
        >
          ✎
        </button>
      </div>
    </div>
  );
}
