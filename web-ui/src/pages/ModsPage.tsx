import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ProgressBar, StatusBadge } from '../components/StatusBadge';

export function ModsPage() {
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['mods'],
    queryFn: api.mods.list,
  });

  if (isLoading) return <div style={styles.center}>Loading mods…</div>;
  if (error) return <div style={{ ...styles.center, color: '#f44' }}>Error: {String(error)}</div>;
  if (!data?.length)
    return (
      <div style={styles.center}>
        <h2>No mods found</h2>
        <p style={{ color: '#888' }}>
          Run <code>npm run learn:pairs</code> or <code>npm run learn:multilang</code> to import
          translation data.
        </p>
      </div>
    );

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Mods</h1>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Strings</th>
            <th style={styles.th}>Progress</th>
            <th style={styles.th}>Approved</th>
            <th style={styles.th}>Fuzzy</th>
          </tr>
        </thead>
        <tbody>
          {data.map((mod) => {
            const approvedPct =
              mod.string_count > 0 ? Math.round((mod.approved_count / mod.string_count) * 100) : 0;
            const fuzzyPct =
              mod.string_count > 0 ? Math.round((mod.fuzzy_count / mod.string_count) * 100) : 0;
            const translatedPct =
              mod.string_count > 0
                ? Math.round((mod.translated_count / mod.string_count) * 100)
                : 0;

            return (
              <tr
                key={mod.id}
                style={styles.rowHover}
                onClick={() => nav(`/mods/${mod.id}`)}
              >
                <td style={styles.td}>
                  <strong style={{ color: '#ddd' }}>{mod.name}</strong>
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{mod.string_count}</td>
                <td style={{ ...styles.td, minWidth: 160 }}>
                  <ProgressBar
                    stats={{
                      total: mod.string_count,
                      translated: mod.translated_count,
                      approved: mod.approved_count,
                      tm: 0,
                      fuzzy: mod.fuzzy_count,
                      auto_translated: mod.translated_count - mod.approved_count - mod.fuzzy_count,
                      untranslated: mod.string_count - mod.translated_count,
                      percent: translatedPct,
                    }}
                  />
                </td>
                <td style={styles.td}>
                  <StatusBadge status={approvedPct === 100 ? 'human' : null} small />
                  <span style={{ marginLeft: 4, color: '#bbb', fontSize: 12 }}>{approvedPct}%</span>
                </td>
                <td style={styles.td}>
                  <span style={{ color: '#bbb', fontSize: 12 }}>{fuzzyPct}%</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  page: { padding: '24px 32px', maxWidth: 960, margin: '0 auto' } as React.CSSProperties,
  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    color: '#bbb',
  } as React.CSSProperties,
  title: { color: '#eee', marginBottom: 24 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    textAlign: 'left' as const,
    color: '#999',
    fontSize: 12,
    padding: '8px 12px',
    borderBottom: '1px solid #333',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  } as React.CSSProperties,
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #222',
    color: '#ccc',
    fontSize: 13,
    verticalAlign: 'middle' as const,
  } as React.CSSProperties,
  rowHover: { cursor: 'pointer' } as React.CSSProperties,
};
