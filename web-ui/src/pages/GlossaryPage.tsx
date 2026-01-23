import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type GlossaryEntry } from '../api';
import s from './GlossaryPage.module.scss';

export const GlossaryPage = () => {
  const qc = useQueryClient();
  const [srcLang, setSrcLang] = useState('en');
  const [tgtLang, setTgtLang] = useState('uk');
  const [q, setQ] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [newTranslation, setNewTranslation] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['glossary', srcLang, tgtLang, q],
    queryFn: () => api.glossary.list({ srcLang: srcLang || undefined, tgtLang: tgtLang || undefined, q: q || undefined }),
  });

  const add = useMutation({
    mutationFn: () => api.glossary.add(newTerm.trim(), newTranslation.trim() || null, srcLang, tgtLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['glossary'] });
      setNewTerm('');
      setNewTranslation('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.glossary.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });

  return (
    <div className={s.page}>
      <h1 className={s.title}>Glossary</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Glossary term pairs are used for QA validation (checking that translations contain required terms)
        and are injected into the LLM system prompt during batch translation.
      </p>

      {/* Controls */}
      <div className={s.toolbar}>
        <label style={{ color: '#888', fontSize: 12 }}>Source:
          <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)} className={s.select} style={{ marginLeft: 4 }}>
            <option value="en">EN</option>
            <option value="uk">UK</option>
            <option value="">All</option>
          </select>
        </label>
        <label style={{ color: '#888', fontSize: 12 }}>Target:
          <select value={tgtLang} onChange={(e) => setTgtLang(e.target.value)} className={s.select} style={{ marginLeft: 4 }}>
            <option value="uk">UK</option>
            <option value="en">EN</option>
            <option value="">All</option>
          </select>
        </label>
        <input
          placeholder="Filter terms…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={s.input}
        />
      </div>

      {/* Add term pair */}
      <div className={s.toolbar} style={{ marginBottom: 24 }}>
        <input
          placeholder="Source term (e.g. Vault)"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          className={s.input}
          style={{ maxWidth: 240 }}
        />
        <span style={{ color: '#666', fontSize: 15 }}>→</span>
        <input
          placeholder="Translation (e.g. Сховище)"
          value={newTranslation}
          onChange={(e) => setNewTranslation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newTerm.trim() && add.mutate()}
          className={s.input}
          style={{ maxWidth: 240 }}
        />
        <button
          onClick={() => newTerm.trim() && add.mutate()}
          disabled={add.isPending || !newTerm.trim()}
          className={s.btnAdd}
        >
          Add Pair
        </button>
        {add.isError && <span style={{ color: '#f44', fontSize: 12 }}>{add.error?.message}</span>}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className={s.center}>Loading…</div>
      ) : !data?.length ? (
        <div className={s.center}>
          <p>No glossary terms yet.</p>
          <p style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
            Add source → translation term pairs above to enforce terminology consistency.
          </p>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th}>Source Term</th>
              <th className={s.th}>Translation</th>
              <th className={s.th}>Langs</th>
              <th className={s.th}>Source</th>
              <th className={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry: GlossaryEntry) => (
              <tr key={entry.id} className={s.tr}>
                <td className={s.td} style={{ fontWeight: 500, color: '#ddd' }}>{entry.term}</td>
                <td className={s.td} style={{ color: entry.translation ? '#b5e8a0' : '#666', fontStyle: entry.translation ? 'normal' : 'italic' }}>
                  {entry.translation ?? '—'}
                </td>
                <td className={s.td} style={{ fontSize: 11 }}>
                  <span className={s.langBadge}>{entry.src_lang}→{entry.tgt_lang}</span>
                </td>
                <td className={s.td} style={{ color: '#666', fontSize: 12 }}>{entry.source}</td>
                <td className={s.td}>
                  <button
                    onClick={() => remove.mutate(entry.id)}
                    disabled={remove.isPending}
                    className={s.btnDelete}
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
