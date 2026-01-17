import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

type Props = {
  stringId: number;
  translationId: number | null;
  text: string | null;
  status: string | null;
  queryKey: unknown[];
};

export const InlineEditor = ({ stringId, translationId, text, status, queryKey }: Props) => {
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
      <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(2, draft.split('\n').length)}
          style={{
            width: '100%',
            background: '#1a1a1a',
            color: '#eee',
            border: '1px solid #555',
            borderRadius: 4,
            padding: 4,
            fontFamily: 'inherit',
            fontSize: 13,
            resize: 'vertical',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.mutate();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            style={btnStyle('#4caf50')}
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} style={btnStyle('#555')}>
            Cancel
          </button>
        </div>
        {save.isError && (
          <span style={{ color: '#f44', fontSize: 11 }}>{save.error?.message}</span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer' }}
      onClick={() => {
        setDraft(text ?? '');
        setEditing(true);
      }}
      title="Click to edit"
    >
      <span
        style={{
          flex: 1,
          color: text ? '#eee' : '#666',
          fontStyle: text ? 'normal' : 'italic',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text ?? '(empty — click to add)'}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {text && status !== 'reviewed' && status !== 'human' && translationId && (
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            style={btnStyle('#2196f3')}
            title="Mark as approved"
          >
            ✓
          </button>
        )}
        <button
          onClick={() => {
            setDraft(text ?? '');
            setEditing(true);
          }}
          style={btnStyle('#333')}
          title="Edit"
        >
          ✎
        </button>
      </div>
    </div>
  );
}

const btnStyle = (bg: string) => {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 12,
  };
}
