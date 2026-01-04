import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type GlossaryEntry } from '../api';

export function GlossaryPage() {
  const qc = useQueryClient();
  const [lang, setLang] = useState('uk');
  const [q, setQ] = useState('');
  const [newTerm, setNewTerm] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['glossary', lang, q],
    queryFn: () => api.glossary.list({ lang: lang || undefined, q: q || undefined }),
  });

  const add = useMutation({
    mutationFn: () => api.glossary.add(newTerm.trim(), lang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['glossary'] });
      setNewTerm('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.glossary.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });

  return (
    <div style={s.page}>
      <h1 style={s.title}>Glossary</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Glossary terms are automatically injected into the LLM system prompt during batch translation
        to ensure consistent terminology.
      </p>

      {/* Controls */}
      <div style={s.toolbar}>
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={s.select}>
          <option value="uk">Ukrainian (uk)</option>
          <option value="en">English (en)</option>
          <option value="">All</option>
        </select>
        <input
          placeholder="Filter terms…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={s.input}
        />
      </div>

      {/* Add term */}
      <div style={{ ...s.toolbar, marginBottom: 24 }}>
        <input
          placeholder="New term…"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newTerm.trim() && add.mutate()}
          style={{ ...s.input, maxWidth: 300 }}
        />
        <button
          onClick={() => newTerm.trim() && add.mutate()}
          disabled={add.isPending || !newTerm.trim()}
          style={s.btnAdd}
        >
          Add Term
        </button>
        {add.isError && <span style={{ color: '#f44', fontSize: 12 }}>{add.error?.message}</span>}
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={s.center}>Loading…</div>
      ) : !data?.length ? (
        <div style={s.center}>
          <p>No glossary terms yet.</p>
          <p style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
            Terms are added automatically when running <code>npm run learn:multilang</code>, or
            manually above.
          </p>
        </div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Term</th>
              <th style={s.th}>Lang</th>
              <th style={s.th}>Count</th>
              <th style={s.th}>Source</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry: GlossaryEntry) => (
              <tr key={entry.id} style={s.tr}>
                <td style={{ ...s.td, fontWeight: 500, color: '#ddd' }}>{entry.term}</td>
                <td style={{ ...s.td, fontSize: 11 }}>
                  <span style={s.langBadge}>{entry.lang}</span>
                </td>
                <td style={{ ...s.td, color: '#888', textAlign: 'right' }}>{entry.count}</td>
                <td style={{ ...s.td, color: '#666', fontSize: 12 }}>{entry.source}</td>
                <td style={s.td}>
                  <button
                    onClick={() => remove.mutate(entry.id)}
                    disabled={remove.isPending}
                    style={s.btnDelete}
                    title="Delete term"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const s = {
  page: { padding: '24px 32px', maxWidth: 800, margin: '0 auto' } as React.CSSProperties,
  title: { color: '#eee', marginBottom: 8 } as React.CSSProperties,
  toolbar: { display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' as const, alignItems: 'center' } as React.CSSProperties,
  select: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '5px 8px', fontSize: 13 } as React.CSSProperties,
  input: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '5px 10px', fontSize: 13, flex: 1, minWidth: 160 } as React.CSSProperties,
  btnAdd: { background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const } as React.CSSProperties,
  th: { textAlign: 'left' as const, color: '#888', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #333', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  tr: { borderBottom: '1px solid #1a1a1a' } as React.CSSProperties,
  td: { padding: '8px', verticalAlign: 'middle' as const, color: '#ccc', fontSize: 13 } as React.CSSProperties,
  langBadge: { background: '#1a3a5c', color: '#7cc8ff', borderRadius: 3, padding: '1px 6px', fontSize: 11, fontFamily: 'monospace' } as React.CSSProperties,
  btnDelete: { background: 'transparent', color: '#777', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 3 } as React.CSSProperties,
  center: { padding: 32, textAlign: 'center' as const, color: '#888' } as React.CSSProperties,
};
