import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type DiffEntry } from '../api';
import { StatusBadge } from '../components/StatusBadge';

const CHANGE_COLORS: Record<string, string> = {
  added: '#1b3a1b',
  removed: '#3a1b1b',
  changed: '#2a2a0f',
};

const CHANGE_LABELS: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

export function DiffPage() {
  const { data: mods } = useQuery({ queryKey: ['mods'], queryFn: api.mods.list });

  const [newModId, setNewModId] = useState('');
  const [oldModId, setOldModId] = useState('');
  const [filter, setFilter] = useState<'all' | 'added' | 'removed' | 'changed'>('all');

  const {
    data: diff,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['diff', newModId, oldModId],
    queryFn: () => api.mods.diff(Number(newModId), Number(oldModId)),
    enabled: false, // manual trigger
  });

  const allEntries: DiffEntry[] = diff
    ? [
        ...(filter === 'all' || filter === 'added' ? diff.added : []),
        ...(filter === 'all' || filter === 'removed' ? diff.removed : []),
        ...(filter === 'all' || filter === 'changed' ? diff.changed : []),
      ]
    : [];

  return (
    <div style={s.page}>
      <h1 style={s.title}>Mod Diff</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
        Compare two mod versions to see added, removed, and changed strings.
      </p>

      {/* Controls */}
      <div style={s.toolbar}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={s.label}>New version (updated mod)</label>
          <select value={newModId} onChange={(e) => setNewModId(e.target.value)} style={s.select}>
            <option value="">Select mod…</option>
            {mods?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={s.label}>Old version (base for comparison)</label>
          <select value={oldModId} onChange={(e) => setOldModId(e.target.value)} style={s.select}>
            <option value="">Select mod…</option>
            {mods?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={s.label}>&nbsp;</label>
          <button
            onClick={() => refetch()}
            disabled={!newModId || !oldModId || isFetching}
            style={s.btnCompare}
          >
            {isFetching ? 'Comparing…' : 'Compare'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#f44', marginTop: 12 }}>Error: {String(error)}</p>}

      {diff && (
        <>
          {/* Summary */}
          <div style={s.summary}>
            {[
              ['added', diff.added.length, '#4caf50'],
              ['removed', diff.removed.length, '#f44336'],
              ['changed', diff.changed.length, '#ff9800'],
              ['unchanged', diff.unchanged, '#555'],
            ].map(([type, count, color]) => (
              <span
                key={type as string}
                style={{ ...s.chip, borderColor: color as string, color: color as string, cursor: type !== 'unchanged' ? 'pointer' : 'default' }}
                onClick={() => type !== 'unchanged' && setFilter(filter === type ? 'all' : (type as typeof filter))}
              >
                {CHANGE_LABELS[type as string] ?? type}: {count as number}
              </span>
            ))}
          </div>

          {/* Filter buttons */}
          <div style={s.filterRow}>
            {(['all', 'added', 'removed', 'changed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{ ...s.filterBtn, ...(filter === f ? s.filterBtnActive : {}) }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Table */}
          {allEntries.length === 0 ? (
            <p style={{ color: '#888', textAlign: 'center', padding: 32 }}>
              No {filter === 'all' ? 'differences' : filter} entries.
            </p>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Change</th>
                  <th style={s.th}>FormID</th>
                  <th style={s.th}>Type</th>
                  <th style={{ ...s.th, minWidth: 220 }}>Source (EN)</th>
                  <th style={{ ...s.th, minWidth: 220 }}>Translation</th>
                  <th style={s.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {allEntries.map((entry, i) => (
                  <tr key={i} style={{ background: CHANGE_COLORS[entry.changeType] ?? 'transparent' }}>
                    <td style={{ ...s.td, fontWeight: 700, color: changeColor(entry.changeType) }}>
                      {entry.changeType}
                    </td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>
                      {entry.formid_hex}
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{entry.signature}</td>
                    <td style={{ ...s.td, maxWidth: 300, wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontSize: 12 }}>
                      {entry.source}
                    </td>
                    <td style={{ ...s.td, maxWidth: 300, wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontSize: 12, color: '#bbb' }}>
                      {entry.translation ?? <span style={{ color: '#555', fontStyle: 'italic' }}>—</span>}
                    </td>
                    <td style={s.td}>
                      <StatusBadge status={entry.status} small />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function changeColor(type: string) {
  return type === 'added' ? '#4caf50' : type === 'removed' ? '#f44336' : '#ff9800';
}

const s = {
  page: { padding: '24px 32px', maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,
  title: { color: '#eee', marginBottom: 8 } as React.CSSProperties,
  toolbar: { display: 'flex', gap: 16, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' as const } as React.CSSProperties,
  label: { color: '#888', fontSize: 12 } as React.CSSProperties,
  select: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 13, minWidth: 220 } as React.CSSProperties,
  btnCompare: { background: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 } as React.CSSProperties,
  summary: { display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' as const } as React.CSSProperties,
  chip: { border: '1px solid', borderRadius: 4, padding: '3px 10px', fontSize: 13, fontWeight: 600 } as React.CSSProperties,
  filterRow: { display: 'flex', gap: 6, marginBottom: 12 } as React.CSSProperties,
  filterBtn: { background: '#2a2a2a', color: '#aaa', border: '1px solid #444', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 } as React.CSSProperties,
  filterBtnActive: { background: '#1565c0', color: '#fff', borderColor: '#1565c0' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: { textAlign: 'left' as const, color: '#888', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #333', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  td: { padding: '8px', verticalAlign: 'top' as const, color: '#ccc', borderBottom: '1px solid #1a1a1a' } as React.CSSProperties,
};
